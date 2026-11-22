import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ChromeDriver } from '../../electron/services/drivers/ChromeDriver';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import { startLocalDetectorServer } from '../fixtures/localServer';
import type { Profile } from '@shared/types';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-int-geo-fp-'));
  tempDirs.push(dir);
  return dir;
}

interface DetectorReport {
  timezone: string;
  timezoneOffset: number;
  language: string;
  languages: string[];
  userAgent: string;
  platform: string;
  screen: { width: number; height: number };
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  webgl: { vendor: string; renderer: string };
  canvasHash: string;
  audioHash: string;
  webdriver: boolean;
  toStringChecks: { toDataURL: string; resolvedOptions: string; getParameter: string };
  geolocation: { latitude: number; longitude: number } | null;
  iframe: { timezone: string; language: string; platform: string; webdriver: boolean } | null;
  worker: { timezone: string; language: string; platform: string; hardwareConcurrency: number } | null;
  crossChecks: { uaMatchesPlatform: boolean; gpuMatchesOs: boolean };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient locks
      }
    }
  }
});

describe('Integration: Áp dụng Geo & Fingerprint trên Chrome thật (detector.html)', () => {
  it(
    'áp dụng chính xác timezone, locale, geolocation, fingerprint, native toString, canvas/audio hash nhất quán trên main frame, iframe và Worker',
    async () => {
      const server = await startLocalDetectorServer();
      const root = makeTempDir();
      const driver = new ChromeDriver();
      const idA = generateConsistentIdentity('windows', 'chrome');
      const idB = generateConsistentIdentity('windows', 'chrome');
      idB.fingerprint.canvasNoiseSeed = idA.fingerprint.canvasNoiseSeed + 12345;
      idB.fingerprint.audioNoiseSeed = idA.fingerprint.audioNoiseSeed + 12345;

      const profileA: Profile = {
        id: 'fp-a',
        name: 'Profile A',
        folderId: null,
        status: 'active',
        tags: [],
        notes: '',
        platform: idA.platform,
        osVersion: idA.osVersion,
        browser: 'chrome',
        browserVersion: idA.browserVersion,
        userAgent: idA.userAgent,
        proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
        ipv6Policy: 'block',
        geo: {
          mode: 'manual',
          timezone: 'America/New_York',
          language: 'en-US',
          lat: 40.7128,
          lon: -74.006,
        },
        fingerprint: idA.fingerprint,
        startup: { urls: [], restoreTabs: false },
        createdAt: new Date().toISOString(),
        lastRunAt: null,
        deletedAt: null,
      };

      const profileB: Profile = {
        ...profileA,
        id: 'fp-b',
        name: 'Profile B',
        fingerprint: idB.fingerprint,
      };

      const resolvedGeo = {
        timezone: 'America/New_York',
        language: 'en-US',
        acceptLanguage: 'en-US,en;q=0.9',
        lat: 40.7128,
        lon: -74.006,
        accuracy: 50,
      };

      const runDetector = async (p: Profile, userDir: string): Promise<DetectorReport> => {
        const inst = await driver.launch({
          profile: p,
          userDataDir: userDir,
          proxyServerUrl: null,
          resolvedGeo,
          onUnexpectedClose: () => {},
        });
        try {
          const browser = await chromium.connectOverCDP(inst.wsEndpoint);
          const ctx = browser.contexts()[0]!;
          const page = await ctx.newPage();
          await page.goto(`${server.url}/detector.html`, { waitUntil: 'networkidle' });
          await page.waitForFunction(() => Boolean((window as unknown as { __reportReady?: boolean }).__reportReady));
          return (await page.evaluate(
            () => (window as unknown as { __report: DetectorReport }).__report,
          )) as DetectorReport;
        } finally {
          await driver.close(p.id);
        }
      };

      try {
        const dirA = path.join(root, 'a');
        const dirB = path.join(root, 'b');

        const reportA1 = await runDetector(profileA, dirA);
        const reportA2 = await runDetector(profileA, dirA);
        const reportB = await runDetector(profileB, dirB);

        // Geo checks (main frame + iframe + worker)
        expect(reportA1.timezone).toBe('America/New_York');
        expect(reportA1.language).toBe('en-US');
        expect(reportA1.languages).toContain('en-US');
        expect([240, 300]).toContain(reportA1.timezoneOffset); // EDT or EST
        expect(reportA1.geolocation?.latitude).toBeCloseTo(40.7128, 3);
        expect(reportA1.geolocation?.longitude).toBeCloseTo(-74.006, 3);

        expect(reportA1.iframe?.timezone).toBe('America/New_York');
        expect(reportA1.iframe?.language).toBe('en-US');
        expect(reportA1.worker?.timezone).toBe('America/New_York');
        expect(reportA1.worker?.language).toBe('en-US');

        // Fingerprint checks
        expect(reportA1.hardwareConcurrency).toBe(profileA.fingerprint.hardware.cores);
        expect(reportA1.deviceMemory).toBe(profileA.fingerprint.hardware.memory);
        expect(reportA1.platform).toBe('Win32');
        expect(reportA1.screen.width).toBe(profileA.fingerprint.screen.width);
        expect(reportA1.screen.height).toBe(profileA.fingerprint.screen.height);
        expect(reportA1.devicePixelRatio).toBe(profileA.fingerprint.screen.dpr);
        expect(reportA1.webgl.vendor).toBe(profileA.fingerprint.webgl.vendor);
        expect(reportA1.webgl.renderer).toBe(profileA.fingerprint.webgl.renderer);

        // Anti-detection checks
        expect(reportA1.webdriver).toBe(false);
        expect(reportA1.toStringChecks.toDataURL).toContain('[native code]');
        expect(reportA1.toStringChecks.resolvedOptions).toContain('[native code]');
        expect(reportA1.toStringChecks.getParameter).toContain('[native code]');
        expect(reportA1.crossChecks.uaMatchesPlatform).toBe(true);
        expect(reportA1.crossChecks.gpuMatchesOs).toBe(true);

        // Deterministic canvas & audio hash: same profile -> same hash; different profile -> different hash
        expect(reportA1.canvasHash).toBe(reportA2.canvasHash);
        expect(reportA1.audioHash).toBe(reportA2.audioHash);
        expect(reportA1.canvasHash).not.toBe(reportB.canvasHash);
        expect(reportA1.audioHash).not.toBe(reportB.audioHash);
      } finally {
        await driver.close(profileA.id);
        await driver.close(profileB.id);
        await server.close();
      }
    },
    90_000,
  );
});
