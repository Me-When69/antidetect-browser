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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-int-iso-'));
  tempDirs.push(dir);
  return dir;
}

function makeProfile(id: string, name: string): Profile {
  const identity = generateConsistentIdentity('windows', 'chrome');
  return {
    id,
    name,
    folderId: null,
    status: 'active',
    tags: [],
    notes: '',
    platform: identity.platform,
    osVersion: identity.osVersion,
    browser: 'chrome',
    browserVersion: identity.browserVersion,
    userAgent: identity.userAgent,
    proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
    ipv6Policy: 'block',
    geo: { mode: 'manual', timezone: 'Asia/Ho_Chi_Minh', language: 'vi-VN', lat: null, lon: null },
    fingerprint: identity.fingerprint,
    startup: { urls: [], restoreTabs: false },
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    deletedAt: null,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient locks on Windows
      }
    }
  }
});

describe('Integration: Cô lập dữ liệu giữa 2 hồ sơ (Chrome thật)', () => {
  it(
    'hai hồ sơ có cookie và localStorage hoàn toàn tách biệt và giữ nguyên sau khi đóng mở lại',
    async () => {
      const server = await startLocalDetectorServer();
      const root = makeTempDir();
      const driver = new ChromeDriver();
      const p1 = makeProfile('iso-1', 'Profile 1');
      const p2 = makeProfile('iso-2', 'Profile 2');
      const dir1 = path.join(root, 'p1');
      const dir2 = path.join(root, 'p2');
      const geo = {
        timezone: 'Asia/Ho_Chi_Minh',
        language: 'vi-VN',
        acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
        lat: null,
        lon: null,
      };

      try {
        const inst1 = await driver.launch({
          profile: p1,
          userDataDir: dir1,
          proxyServerUrl: null,
          resolvedGeo: geo,
          onUnexpectedClose: () => {},
        });
        const inst2 = await driver.launch({
          profile: p2,
          userDataDir: dir2,
          proxyServerUrl: null,
          resolvedGeo: geo,
          onUnexpectedClose: () => {},
        });

        const b1 = await chromium.connectOverCDP(inst1.wsEndpoint);
        const b2 = await chromium.connectOverCDP(inst2.wsEndpoint);
        const page1 = b1.contexts()[0]!.pages()[0] ?? (await b1.contexts()[0]!.newPage());
        const page2 = b2.contexts()[0]!.pages()[0] ?? (await b2.contexts()[0]!.newPage());

        await page1.goto(`${server.url}/detector.html`, { waitUntil: 'domcontentloaded' });
        await page2.goto(`${server.url}/detector.html`, { waitUntil: 'domcontentloaded' });

        await page1.evaluate(() => {
          document.cookie = 'session_user=alice; path=/; max-age=3600';
          localStorage.setItem('account', 'alice_store');
        });
        await page2.evaluate(() => {
          document.cookie = 'session_user=bob; path=/; max-age=3600';
          localStorage.setItem('account', 'bob_store');
        });

        expect(await page1.evaluate(() => localStorage.getItem('account'))).toBe('alice_store');
        expect(await page2.evaluate(() => localStorage.getItem('account'))).toBe('bob_store');

        await driver.close(p1.id);
        await driver.close(p2.id);

        // Relaunch profile 1 and verify persistence
        const inst1Again = await driver.launch({
          profile: p1,
          userDataDir: dir1,
          proxyServerUrl: null,
          resolvedGeo: geo,
          onUnexpectedClose: () => {},
        });
        const b1Again = await chromium.connectOverCDP(inst1Again.wsEndpoint);
        const page1Again =
          b1Again.contexts()[0]!.pages()[0] ?? (await b1Again.contexts()[0]!.newPage());
        await page1Again.goto(`${server.url}/detector.html`, { waitUntil: 'domcontentloaded' });

        const persisted = await page1Again.evaluate(() => ({
          cookie: document.cookie,
          storage: localStorage.getItem('account'),
        }));
        expect(persisted.cookie).toContain('session_user=alice');
        expect(persisted.storage).toBe('alice_store');
      } finally {
        await driver.close(p1.id);
        await driver.close(p2.id);
        await server.close();
      }
    },
    60_000,
  );
});
