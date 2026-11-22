import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ChromeDriver } from '../../electron/services/drivers/ChromeDriver';
import { resolveBrowserExecutable } from '../../electron/services/browserPath';
import { detectExecutableVersion } from '../../electron/services/browserManager';
import { applyDevice, getDeviceById, normalizeBrowserVersion } from '../../electron/services/deviceCatalog';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import { AppLogger } from '../../electron/services/logger';
import { ProfileService } from '../../electron/services/profileService';
import { ProxyService } from '../../electron/services/proxyService';
import { SettingsService } from '../../electron/services/settingsService';
import { ProfileLauncher } from '../../electron/services/launcher';
import type { CreateProfileInput, Profile } from '@shared/types';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function startInspectionServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Emulation Probe</title></head>
<body>
<script>
  window.__collectProbe = async () => {
    const uaData = navigator.userAgentData;
    let highEntropy = null;
    if (uaData && typeof uaData.getHighEntropyValues === 'function') {
      highEntropy = await uaData.getHighEntropyValues([
        'platform', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion', 'fullVersionList'
      ]);
    }
    const iframe = document.createElement('iframe');
    iframe.srcdoc = '<!doctype html><script>parent.__iframeProbe = { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, hasUaData: !!navigator.userAgentData };<\\/script>';
    document.body.appendChild(iframe);
    await new Promise((r) => setTimeout(r, 150));

    const workerCode = \`
      self.onmessage = async () => {
        const hasUaData = !!self.navigator.userAgentData;
        let mobile = null;
        let platform = null;
        if (hasUaData) {
          mobile = self.navigator.userAgentData.mobile;
          platform = self.navigator.userAgentData.platform;
        }
        self.postMessage({
          userAgent: self.navigator.userAgent,
          platform: self.navigator.platform,
          hasUaData,
          mobile,
          uaPlatform: platform
        });
      };
    \`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    const workerProbe = await new Promise((res) => {
      worker.onmessage = (ev) => res(ev.data);
      worker.postMessage('go');
    });
    worker.terminate();

    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      hasOntouchstart: 'ontouchstart' in window,
      pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
      screen: { width: screen.width, height: screen.height },
      dpr: window.devicePixelRatio,
      hasUaData: typeof navigator.userAgentData !== 'undefined',
      uaDataMobile: uaData ? uaData.mobile : null,
      uaDataPlatform: uaData ? uaData.platform : null,
      highEntropy,
      iframeProbe: window.__iframeProbe || null,
      workerProbe
    };
  };
</script>
</body>
</html>`;

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function makeBaseInput(): CreateProfileInput {
  return {
    name: 'Emulation Int Profile',
    folderId: null,
    status: 'active',
    tags: [],
    notes: '',
    platform: 'windows',
    osVersion: 'Windows 11',
    browser: 'chrome',
    browserVersion: '136.0.0.0',
    userAgent: 'auto',
    proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
    ipv6Policy: 'block',
    geo: { mode: 'manual', timezone: 'UTC', language: 'en-US', lat: null, lon: null },
    fingerprint: {
      screen: { width: 1920, height: 1080, dpr: 1 },
      hardware: { cores: 8, memory: 16 },
      webgl: { vendor: 'Google Inc.', renderer: 'ANGLE' },
      canvasNoiseSeed: 101,
      audioNoiseSeed: 202,
      fonts: ['Segoe UI', 'Arial'],
      webrtc: 'replace',
    },
    startup: { urls: [], restoreTabs: false },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file locks
      }
    }
  }
});

describe('Integration: Device Emulation (Desktop, Android, iOS) & Downgrade Guard', () => {
  it('emulates Desktop & Android on real Chrome with consistent UA, Client Hints, touch, iframe, and Worker', async () => {
    const resolved = resolveBrowserExecutable();
    const rawVersion = await detectExecutableVersion(resolved.executablePath);
    const realVersion = normalizeBrowserVersion(rawVersion || '136.0.0.0');
    const server = await startInspectionServer();
    const driver = new ChromeDriver();
    const root = makeTempDir('ad-int-emul-');

    const runProbe = async (profile: Profile, userDir: string) => {
      const inst = await driver.launch({
        profile,
        userDataDir: userDir,
        proxyServerUrl: null,
        resolvedGeo: {
          timezone: 'UTC',
          language: 'en-US',
          acceptLanguage: 'en-US,en;q=0.9',
          lat: null,
          lon: null,
          accuracy: 50,
        },
        onUnexpectedClose: () => {},
      });
      try {
        const browser = await chromium.connectOverCDP(inst.wsEndpoint);
        const context = browser.contexts()[0]!;
        const page = await context.newPage();
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(() =>
          (window as unknown as { __collectProbe: () => Promise<Record<string, unknown>> }).__collectProbe(),
        );
        await browser.close().catch(() => {});
        return result;
      } finally {
        await driver.close(profile.id);
      }
    };

    try {
      // 1. Desktop (Windows)
      const winDev = getDeviceById('win11-rtx3060-1080p')!;
      const winApplied = applyDevice(makeBaseInput(), winDev, realVersion);
      const winProfile: Profile = {
        ...winApplied,
        id: 'emul-win',
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        deletedAt: null,
      };
      const winProbe = await runProbe(winProfile, path.join(root, 'win'));
      expect(winProbe['userAgent']).toContain(`Chrome/${realVersion}`);
      expect(winProbe['uaDataMobile']).toBe(false);
      expect(winProbe['uaDataPlatform']).toBe('Windows');
      const winHigh = winProbe['highEntropy'] as Record<string, unknown>;
      expect(winHigh['uaFullVersion']).toBe(realVersion);
      const winWorker = winProbe['workerProbe'] as Record<string, unknown>;
      expect(winWorker['userAgent']).toContain(`Chrome/${realVersion}`);

      // 2. Android (Samsung Galaxy S24 Ultra)
      const androidDev = getDeviceById('android-galaxy-s24-ultra')!;
      const androidApplied = applyDevice(makeBaseInput(), androidDev, realVersion);
      const androidProfile: Profile = {
        ...androidApplied,
        id: 'emul-android',
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        deletedAt: null,
      };
      const androidProbe = await runProbe(androidProfile, path.join(root, 'android'));
      expect(androidProbe['userAgent']).toContain('Android 14');
      expect(androidProbe['userAgent']).toContain('SM-S928B');
      expect(androidProbe['userAgent']).toContain(`Chrome/${realVersion}`);
      expect(androidProbe['uaDataMobile']).toBe(true);
      expect(androidProbe['uaDataPlatform']).toBe('Android');
      const androidHigh = androidProbe['highEntropy'] as Record<string, unknown>;
      expect(androidHigh['model']).toBe('SM-S928B');
      expect(androidProbe['maxTouchPoints']).toBe(5);
      expect(androidProbe['hasOntouchstart']).toBe(true);
      expect(androidProbe['pointerCoarse']).toBe(true);
      expect(androidProbe['screen']).toEqual({ width: 412, height: 915 });
      const androidIframe = androidProbe['iframeProbe'] as Record<string, unknown>;
      expect(androidIframe['maxTouchPoints']).toBe(5);
      const androidWorker = androidProbe['workerProbe'] as Record<string, unknown>;
      expect(androidWorker['mobile']).toBe(true);
      expect(androidWorker['uaPlatform']).toBe('Android');

      // 3. iOS (iPhone 16 Pro — must NOT expose Chrome Client Hints)
      const iosDev = getDeviceById('ios-iphone-16-pro')!;
      const iosApplied = applyDevice(makeBaseInput(), iosDev, realVersion);
      const iosProfile: Profile = {
        ...iosApplied,
        id: 'emul-ios',
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        deletedAt: null,
      };
      const iosProbe = await runProbe(iosProfile, path.join(root, 'ios'));
      expect(iosProbe['userAgent']).toContain('iPhone');
      expect(iosProbe['hasUaData']).toBe(false);
      expect(iosProbe['maxTouchPoints']).toBe(5);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('blocks browser launch with VERSION_DOWNGRADE when lastBrowserVersion > target real version', async () => {
    const root = makeTempDir('ad-int-downgrade-');
    const dbCtx = createDatabase(path.join(root, 'test.db'));
    try {
      const secrets = new SecretService();
      const logger = new AppLogger(path.join(root, 'logs'));
      const profileService = new ProfileService(dbCtx.db, secrets, path.join(root, 'profiles'));
      const proxyService = new ProxyService(dbCtx.db, secrets);
      const settingsService = new SettingsService(dbCtx.db);
      const launcher = new ProfileLauncher(profileService, proxyService, settingsService, logger);

      const created = profileService.create({
        ...makeBaseInput(),
        name: 'Downgrade Guard Profile',
      });
      // Simulate profile previously opened on Chrome 999.0.0.0
      profileService.touchLastRun(created.id, '999.0.0.0');

      const res = await launcher.start(created.id);
      expect(res.running).toBe(false);
      expect(res.downgradeDetected).toBe(true);
      expect(res.errorCode).toBe('VERSION_DOWNGRADE');
      expect(res.downgradeInfo?.lastVersion).toBe('999.0.0.0');
    } finally {
      dbCtx.sqlite.close();
    }
  }, 20_000);
});
