import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLogger } from '../../electron/services/logger';
import { ProxyBridgeManager } from '../../electron/services/proxyBridge';
import { ChromeDriver } from '../../electron/services/drivers/ChromeDriver';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import { startLocalDetectorServer } from '../fixtures/localServer';
import type { Profile } from '@shared/types';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-int-bridge-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Minimal mock upstream SOCKS5 server (with username/password auth) that records
 * every target hostname (ATYP=0x03) it receives and forwards connections to targetPort on 127.0.0.1.
 */
function startMockUpstreamSocks5(
  expectedUser: string,
  expectedPass: string,
): Promise<{
  port: number;
  receivedDomains: string[];
  close: () => Promise<void>;
}> {
  const receivedDomains: string[] = [];
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      let step: 'greeting' | 'auth' | 'request' | 'pipe' = 'greeting';
      let buf = Buffer.alloc(0);

      client.on('error', () => client.destroy());
      client.on('data', (chunk: Buffer) => {
        if (step === 'pipe') return;
        buf = Buffer.concat([buf, chunk]);

        if (step === 'greeting') {
          if (buf.length < 2) return;
          const n = buf[1] ?? 0;
          if (buf.length < 2 + n) return;
          buf = buf.subarray(2 + n);
          step = 'auth';
          client.write(Buffer.from([0x05, 0x02])); // Require username/password auth
        }

        if (step === 'auth') {
          if (buf.length < 2) return;
          const uLen = buf[1] ?? 0;
          if (buf.length < 2 + uLen + 1) return;
          const u = buf.subarray(2, 2 + uLen).toString('utf8');
          const pLen = buf[2 + uLen] ?? 0;
          if (buf.length < 3 + uLen + pLen) return;
          const p = buf.subarray(3 + uLen, 3 + uLen + pLen).toString('utf8');
          buf = buf.subarray(3 + uLen + pLen);

          if (u !== expectedUser || p !== expectedPass) {
            client.end(Buffer.from([0x01, 0x01])); // Auth failure
            return;
          }
          step = 'request';
          client.write(Buffer.from([0x01, 0x00])); // Auth OK
        }

        if (step === 'request') {
          if (buf.length < 4) return;
          const atyp = buf[3];
          let targetHost = '';
          let portOffset = 0;

          if (atyp === 0x01) {
            if (buf.length < 10) return;
            targetHost = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
            portOffset = 8;
          } else if (atyp === 0x03) {
            const len = buf[4] ?? 0;
            if (buf.length < 5 + len + 2) return;
            targetHost = buf.subarray(5, 5 + len).toString('utf8');
            receivedDomains.push(targetHost);
            portOffset = 5 + len;
          } else {
            client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return;
          }

          const targetPort = buf.readUInt16BE(portOffset);
          const trailing = buf.subarray(portOffset + 2);
          buf = Buffer.alloc(0);
          step = 'pipe';

          // Resolve fake test domain to 127.0.0.1 on the proxy side!
          const connectHost = targetHost.endsWith('.test') ? '127.0.0.1' : targetHost;
          const upstream = net.connect(targetPort, connectHost, () => {
            client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            if (trailing.length > 0) upstream.write(trailing);
            client.pipe(upstream);
            upstream.pipe(client);
          });
          upstream.on('error', () => {
            if (!client.destroyed) {
              client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            }
          });
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      resolve({
        port,
        receivedDomains,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
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

describe('Integration: ProxyBridge (SOCKS5h có mật khẩu, DNS phía proxy, Kill Switch & Dọn dẹp)', () => {
  it('Chrome chạy SOCKS5h có mật khẩu qua bridge, phân giải DNS ở phía proxy giả, kích hoạt kill switch khi tắt bridge và đóng sạch cổng cục bộ', async () => {
    const detector = await startLocalDetectorServer();
    const mockSocks = await startMockUpstreamSocks5('u5', 'p5');
    const root = makeTempDir();
    const logger = new AppLogger();
    const bridgeMgr = new ProxyBridgeManager(logger);
    const driver = new ChromeDriver();
    const id = generateConsistentIdentity('windows', 'chrome');

    const profile: Profile = {
      id: 'bridge-socks5h',
      name: 'SOCKS5h Profile',
      folderId: null,
      status: 'active',
      tags: [],
      notes: '',
      platform: id.platform,
      osVersion: id.osVersion,
      browser: 'chrome',
      browserVersion: id.browserVersion,
      userAgent: id.userAgent,
      proxy: {
        type: 'socks5h',
        host: '127.0.0.1',
        port: mockSocks.port,
        username: 'u5',
        password: 'p5',
      },
      ipv6Policy: 'block',
      geo: { mode: 'manual', timezone: 'UTC', language: 'en-US', lat: null, lon: null },
      fingerprint: id.fingerprint,
      startup: { urls: [], restoreTabs: false },
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      deletedAt: null,
    };

    try {
      // 1. Start local bridge
      const handle = await bridgeMgr.startBridge(profile.proxy, profile.id);
      expect(handle.host).toBe('127.0.0.1');
      expect(handle.type).toBe('socks5');

      // 2. Launch real Chrome pointed at local bridge
      const inst = await driver.launch({
        profile,
        userDataDir: path.join(root, 'u1'),
        proxyServerUrl: `${handle.type}://${handle.host}:${handle.port}`,
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

      // Request a fake domain (.test) that only our mock upstream SOCKS5 proxy knows how to resolve!
      await page.goto(`http://remote-dns-proof.test:${detector.port}/ip`, {
        waitUntil: 'domcontentloaded',
      });
      const bodyText = (await page.textContent('body')) ?? '';
      expect(bodyText).toContain('203.0.113.77');
      expect(mockSocks.receivedDomains).toContain('remote-dns-proof.test');

      // 3. Kill Switch: stop bridge mid-session -> browser request MUST fail (never bypass to host!)
      await bridgeMgr.stopBridge(profile.id);
      let navFailed = false;
      try {
        await page.goto(`${detector.url}/ip`, { timeout: 5000 });
      } catch {
        navFailed = true;
      }
      expect(navFailed).toBe(true);

      // 4. Cleanup verification: local bridge port is closed (ECONNREFUSED)
      const portClosed = await new Promise<boolean>((resolve) => {
        const sock = net.connect(handle.port, '127.0.0.1');
        sock.on('connect', () => {
          sock.destroy();
          resolve(false);
        });
        sock.on('error', () => resolve(true));
      });
      expect(portClosed).toBe(true);
    } finally {
      await driver.close(profile.id);
      await bridgeMgr.stopAll();
      await mockSocks.close();
      await detector.close();
    }
  }, 60_000);
});
