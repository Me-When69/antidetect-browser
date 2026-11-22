import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as proxyChain from 'proxy-chain';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import { ProxyService } from '../../electron/services/proxyService';
import { ChromeDriver } from '../../electron/services/drivers/ChromeDriver';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import { startLocalDetectorServer } from '../fixtures/localServer';
import type { Profile } from '@shared/types';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-int-leak-'));
  tempDirs.push(dir);
  return dir;
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

describe('Integration: Kiểm tra rò rỉ Proxy, WebRTC & lỗi Proxy cục bộ', () => {
  it('mọi request đi qua proxy cục bộ, WebRTC không lộ IP nội bộ và bắt đúng lỗi 407 khi sai mật khẩu', async () => {
    const detectorServer = await startLocalDetectorServer();
    const root = makeTempDir();
    const dbCtx = createDatabase(':memory:');
    const proxyService = new ProxyService(dbCtx.db, new SecretService(null));

    let proxiedCount = 0;
    const localProxy = new proxyChain.Server({
      port: 0,
      host: '127.0.0.1',
      prepareRequestFunction: ({ username, password }) => {
        if (username !== 'testuser' || password !== 'testpass') {
          return { requestAuthentication: true };
        }
        proxiedCount += 1;
        return {};
      },
    });
    await localProxy.listen();

    const driver = new ChromeDriver();
    const identity = generateConsistentIdentity('windows', 'chrome');
    const profile: Profile = {
      id: 'leak-1',
      name: 'Leak Check Profile',
      folderId: null,
      status: 'active',
      tags: [],
      notes: '',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: 'chrome',
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: {
        type: 'http',
        host: '127.0.0.1',
        port: localProxy.port,
        username: 'testuser',
        password: 'testpass',
      },
      ipv6Policy: 'block',
      geo: { mode: 'manual', timezone: 'UTC', language: 'en-US', lat: null, lon: null },
      fingerprint: { ...identity.fingerprint, webrtc: 'replace' },
      startup: { urls: [], restoreTabs: false },
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      deletedAt: null,
    };

    try {
      // 1. Open local tunnel & verify Chrome routes traffic through proxy
      const tunnelConn = await proxyService.openTunnelForProfile(profile.id, profile.proxy);
      const inst = await driver.launch({
        profile,
        userDataDir: path.join(root, 'u1'),
        proxyServerUrl: tunnelConn?.server ?? null,
        proxyUsername: tunnelConn?.username,
        proxyPassword: tunnelConn?.password,
        resolvedGeo: {
          timezone: 'UTC',
          language: 'en-US',
          acceptLanguage: 'en-US,en;q=0.9',
          lat: null,
          lon: null,
        },
        onUnexpectedClose: () => {},
      });

      const browser = await chromium.connectOverCDP(inst.wsEndpoint);
      const page = await browser.contexts()[0]!.newPage();
      await page.goto(`${detectorServer.url}/detector.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() =>
        Boolean((window as unknown as { __reportReady?: boolean }).__reportReady),
      );

      const webrtc = (await page.evaluate(
        () =>
          (
            window as unknown as {
              __report: { webrtc: { blocked: boolean; candidates: string[] } };
            }
          ).__report.webrtc,
      )) as { blocked: boolean; candidates: string[] };

      // Must have routed through our local proxy
      expect(proxiedCount).toBeGreaterThan(0);

      // No private LAN IP leaked in WebRTC ICE candidates
      for (const cand of webrtc.candidates) {
        expect(cand).not.toMatch(/typ host|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i);
      }

      // 2. Wrong password returns 407 Vietnamese error
      const wrongAuth = await proxyService.checkProxy(
        {
          type: 'http',
          host: '127.0.0.1',
          port: localProxy.port,
          username: 'testuser',
          password: 'WRONG_PASSWORD',
        },
        true,
      );
      expect(wrongAuth.ok).toBe(false);
      expect(wrongAuth.error).toBe('Sai tài khoản/mật khẩu hoặc chưa whitelist IP');

      // 3. Closed port returns ECONNREFUSED Vietnamese error
      const refused = await proxyService.checkProxy(
        {
          type: 'http',
          host: '127.0.0.1',
          port: 1,
          username: '',
          password: '',
        },
        true,
      );
      expect(refused.ok).toBe(false);
      expect(refused.error).toBe('Proxy từ chối kết nối, kiểm tra host/port hoặc dịch vụ proxy');
    } finally {
      await driver.close(profile.id);
      await proxyService.closeAllTunnels();
      await localProxy.close(true);
      await detectorServer.close();
      dbCtx.sqlite.close();
    }
  }, 60_000);
});
