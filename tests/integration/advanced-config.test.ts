import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ChromeDriver } from '../../electron/services/drivers/ChromeDriver';
import {
  DEFAULT_BANDWIDTH,
  DEFAULT_BEHAVIOR,
  DEFAULT_DATA_ON_CLOSE,
  DEFAULT_MEDIA_DEVICES,
  DEFAULT_SIGNALS,
} from '../../shared/advancedDefaults';
import type { Profile } from '@shared/types';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function startAdvancedProbeServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const pixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const server = http.createServer((req, res) => {
      if (req.url === '/test.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(pixelPng);
        return;
      }
      if (req.url === '/ok.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('window.__scriptLoaded = true;');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Advanced Probe</title>
  <script src="/ok.js"></script>
</head>
<body>
  <img id="probe-img" src="/test.png" width="10" height="10" />
  <script>
    window.__probeAdvanced = async () => {
      // Canvas
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 64, 32);
      ctx.fillStyle = '#abcdef';
      ctx.fillText('probe-canvas', 4, 18);
      const canvasUrl = c.toDataURL();

      // WebGL
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl');
      const webglAvailable = !!gl;

      // Audio
      const audioCtx = new OfflineAudioContext(1, 200, 44100);
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      osc.connect(audioCtx.destination);
      osc.start(0);
      const buf = await audioCtx.startRendering();
      const ch = buf.getChannelData(0);
      let audioSum = 0;
      for (let i = 0; i < ch.length; i += 1) audioSum += Math.abs(ch[i]);

      // Media devices
      const devices = navigator.mediaDevices ? await navigator.mediaDevices.enumerateDevices() : [];
      const counts = {
        cameras: devices.filter((d) => d.kind === 'videoinput').length,
        microphones: devices.filter((d) => d.kind === 'audioinput').length,
        speakers: devices.filter((d) => d.kind === 'audiooutput').length,
      };
      const deviceIds = devices.map((d) => d.deviceId);

      // Image load status
      const img = document.getElementById('probe-img');
      const imgLoaded = Boolean(img && img.complete && img.naturalWidth > 0);

      return {
        canvasUrl,
        webglAvailable,
        audioSum,
        counts,
        deviceIds,
        imgLoaded,
        scriptLoaded: Boolean(window.__scriptLoaded),
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        cookie: document.cookie,
        lsVal: window.localStorage.getItem('keep_me'),
      };
    };
  </script>
</body>
</html>`);
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

function makeProfile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    name: `Adv ${id}`,
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
      webgl: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      canvasNoiseSeed: 424242,
      audioNoiseSeed: 848484,
      fonts: ['Segoe UI', 'Arial'],
      webrtc: 'replace',
      signals: { ...DEFAULT_SIGNALS },
    },
    startup: { urls: [], restoreTabs: false },
    mediaDevices: { ...DEFAULT_MEDIA_DEVICES },
    dataOnClose: { ...DEFAULT_DATA_ON_CLOSE },
    window: {
      width: 960,
      height: 640,
      x: null,
      y: null,
      randomizeSlightly: false,
      maximized: false,
    },
    bandwidth: { ...DEFAULT_BANDWIDTH },
    behavior: { ...DEFAULT_BEHAVIOR },
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    deletedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows locks
      }
    }
  }
});

describe('Integration: Advanced Profile Config on Real Chrome', () => {
  it('verifies real/noise/off signals, mediaDevices, bandwidth blocking, window size, dataOnClose, and zero JS errors', async () => {
    const server = await startAdvancedProbeServer();
    const driver = new ChromeDriver();
    const root = makeTempDir('ad-int-adv-');

    const runProbe = async (
      profile: Profile,
      userDir: string,
      afterLoad?: (page: import('playwright-core').Page) => Promise<void>,
    ) => {
      const pageErrors: string[] = [];
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
        page.on('pageerror', (err) => pageErrors.push(err.message));
        await page.goto(server.url, { waitUntil: 'load' });
        if (afterLoad) {
          await afterLoad(page);
        }
        const data = await page.evaluate(() =>
          (
            window as unknown as { __probeAdvanced: () => Promise<Record<string, unknown>> }
          ).__probeAdvanced(),
        );
        await browser.close().catch(() => {});
        return { data, pageErrors };
      } finally {
        await driver.close(profile.id);
      }
    };

    try {
      // 1. Noise mode + custom mediaDevices (2 cameras, 1 mic, 3 speakers) + window 960x640 + dataOnClose(clearCookies only)
      const pNoise = makeProfile('noise-1', {
        mediaDevices: { cameras: 2, microphones: 1, speakers: 3, mode: 'fake' },
        dataOnClose: {
          clearCookies: true,
          clearCache: false,
          clearHistory: false,
          clearLocalStorage: false,
        },
      });
      const noiseDir = path.join(root, 'noise-1');
      const run1 = await runProbe(pNoise, noiseDir, async (page) => {
        await page.evaluate(() => {
          document.cookie = 'session_tok=secret123; path=/';
          window.localStorage.setItem('keep_me', 'persisted_ok');
        });
      });
      expect(run1.pageErrors).toEqual([]);
      expect(run1.data['webglAvailable']).toBe(true);
      expect(run1.data['counts']).toEqual({ cameras: 2, microphones: 1, speakers: 3 });
      expect(run1.data['imgLoaded']).toBe(true);
      expect(run1.data['scriptLoaded']).toBe(true);
      expect(Number(run1.data['outerWidth'])).toBeLessThanOrEqual(1920);
      expect(Number(run1.data['outerWidth'])).toBeGreaterThanOrEqual(800);

      // Reopen same profile: noise canvas + deviceIds must be IDENTICAL; cookie cleared, localStorage kept!
      const run1b = await runProbe(pNoise, noiseDir);
      expect(run1b.pageErrors).toEqual([]);
      expect(run1b.data['canvasUrl']).toBe(run1.data['canvasUrl']);
      expect(run1b.data['deviceIds']).toEqual(run1.data['deviceIds']);
      expect(String(run1b.data['cookie'])).not.toContain('session_tok=secret123');
      expect(run1b.data['lsVal']).toBe('persisted_ok');

      // 2. Different profile seed -> different canvas hash
      const pNoise2 = makeProfile('noise-2', {
        fingerprint: {
          ...makeProfile('noise-2').fingerprint,
          canvasNoiseSeed: 999888,
          audioNoiseSeed: 777666,
        },
      });
      const run2 = await runProbe(pNoise2, path.join(root, 'noise-2'));
      expect(run2.pageErrors).toEqual([]);
      expect(run2.data['canvasUrl']).not.toBe(run1.data['canvasUrl']);

      // 3. OFF mode (canvas, webgl, audio all off) + blockImages=true: neutral values, NO JS crash, image blocked but script loads!
      const pOff = makeProfile('off-1', {
        fingerprint: {
          ...makeProfile('off-1').fingerprint,
          signals: {
            ...DEFAULT_SIGNALS,
            canvas: 'off',
            webgl: 'off',
            audio: 'off',
          },
        },
        bandwidth: {
          ...DEFAULT_BANDWIDTH,
          blockImages: true,
        },
      });
      const runOff = await runProbe(pOff, path.join(root, 'off-1'));
      expect(runOff.pageErrors).toEqual([]);
      expect(runOff.data['webglAvailable']).toBe(false);
      expect(runOff.data['audioSum']).toBe(0);
      expect(String(runOff.data['canvasUrl'])).toContain(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      );
      expect(runOff.data['imgLoaded']).toBe(false);
      expect(runOff.data['scriptLoaded']).toBe(true);

      // 4. REAL mode: no interference, zero JS errors
      const pReal = makeProfile('real-1', {
        fingerprint: {
          ...makeProfile('real-1').fingerprint,
          signals: {
            canvas: 'real',
            webgl: 'real',
            webglMetadata: 'real',
            audio: 'real',
            clientRects: 'real',
            fonts: 'real',
            speechVoices: 'real',
            battery: 'real',
            portScanProtect: false,
          },
        },
        mediaDevices: { ...DEFAULT_MEDIA_DEVICES, mode: 'real' },
      });
      const runReal = await runProbe(pReal, path.join(root, 'real-1'));
      expect(runReal.pageErrors).toEqual([]);
      expect(runReal.data['webglAvailable']).toBe(true);
      expect(Number(runReal.data['audioSum'])).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 90_000);
});
