import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { profilesTable } from '../../electron/db/schema';
import { SecretService } from '../../electron/services/secretService';
import { ProfileService } from '../../electron/services/profileService';
import { buildBrowserProxyArgs } from '../../electron/services/proxyBridge';
import { buildSingBoxConfig } from '../../electron/services/proxyCoreManager';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import type { ProfileProxy } from '@shared/types';

function makeProxy(overrides: Partial<ProfileProxy>): ProfileProxy {
  return {
    type: 'http',
    host: '198.51.100.10',
    port: 8080,
    username: '',
    password: '',
    ...overrides,
  };
}

describe('Unit: buildBrowserProxyArgs (bảng quy tắc trực tiếp vs qua bridge)', () => {
  it('truyền thẳng cho HTTP/HTTPS (có hoặc không mật khẩu), SOCKS4, và SOCKS5 không mật khẩu', () => {
    expect(buildBrowserProxyArgs(makeProxy({ type: 'http' }), 'chrome').viaBridge).toBe(false);
    expect(
      buildBrowserProxyArgs(makeProxy({ type: 'https', username: 'u', password: 'p' }), 'chrome')
        .viaBridge,
    ).toBe(false);
    expect(
      buildBrowserProxyArgs(makeProxy({ type: 'socks4', port: 1080 }), 'chrome').viaBridge,
    ).toBe(false);
    expect(
      buildBrowserProxyArgs(makeProxy({ type: 'socks5', port: 1080 }), 'chrome').viaBridge,
    ).toBe(false);
  });

  it('SOCKS5 có mật khẩu: Chrome bắt buộc qua bridge, Firefox truyền thẳng được', () => {
    const p = makeProxy({ type: 'socks5', port: 1080, username: 'u', password: 'p' });
    expect(buildBrowserProxyArgs(p, 'chrome').viaBridge).toBe(true);
    expect(buildBrowserProxyArgs(p, 'firefox').viaBridge).toBe(false);
  });

  it('SOCKS4a, SOCKS5h, SSH, Shadowsocks, VMess, VLESS, Trojan và Chain luôn đi qua bridge', () => {
    const bridgeTypes: ProfileProxy['type'][] = [
      'socks4a',
      'socks5h',
      'ssh',
      'shadowsocks',
      'vmess',
      'vless',
      'trojan',
    ];
    for (const type of bridgeTypes) {
      const decision = buildBrowserProxyArgs(makeProxy({ type, port: 1080 }), 'chrome');
      expect(decision.viaBridge, `Mong đợi ${type} đi qua bridge`).toBe(true);
      expect(decision.dnsLeakRisk).toBe(false);
    }

    const chained = makeProxy({
      type: 'http',
      chain: [makeProxy({ type: 'socks5', host: '10.0.0.2', port: 1080 })],
    });
    expect(buildBrowserProxyArgs(chained, 'chrome').viaBridge).toBe(true);
  });

  it('sinh cấu hình sing-box hợp lệ với inbound chỉ bind 127.0.0.1 và outbound detour chain', () => {
    const cfg = buildSingBoxConfig(
      makeProxy({
        type: 'vless',
        host: 'hop1.example.com',
        port: 443,
        extra: {
          uuid: '11111111-2222-3333-4444-555555555555',
          tls: 'tls',
          network: 'ws',
          path: '/ws',
        },
        chain: [
          makeProxy({
            type: 'shadowsocks',
            host: 'hop2.example.com',
            port: 8388,
            password: 'ss-password',
            extra: { cipher: 'aes-256-gcm' },
          }),
        ],
      }),
      18080,
    );

    const inbounds = cfg['inbounds'] as { listen: string; listen_port: number }[];
    expect(inbounds[0]?.listen).toBe('127.0.0.1');
    expect(inbounds[0]?.listen_port).toBe(18080);

    const outbounds = cfg['outbounds'] as { tag: string; detour?: string }[];
    expect(outbounds[0]?.tag).toBe('hop-0');
    expect(outbounds[1]?.tag).toBe('proxy');
    expect(outbounds[1]?.detour).toBe('hop-0');
  });

  it('mã hóa password, privateKey, extra.uuid và chain hop passwords trong SQLite (không lưu plaintext)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-bridge-sec-'));
    const dbCtx = createDatabase(':memory:');
    const service = new ProfileService(dbCtx.db, new SecretService(null), tmpDir);
    const id = generateConsistentIdentity('windows', 'chrome');
    try {
      const created = service.create({
        name: 'Secret Test',
        folderId: null,
        status: 'none',
        tags: [],
        notes: '',
        platform: id.platform,
        osVersion: id.osVersion,
        browser: 'chrome',
        browserVersion: id.browserVersion,
        userAgent: id.userAgent,
        proxy: {
          type: 'ssh',
          host: '203.0.113.5',
          port: 22,
          username: 'root',
          password: 'MySecretSshPassword',
          privateKey: '-----BEGIN PRIVATE KEY-----\nSECRET_KEY_BODY',
          extra: { uuid: '11111111-2222-3333-4444-555555555555' },
          chain: [
            makeProxy({
              type: 'trojan',
              host: 'hop2.example.com',
              port: 443,
              password: 'Hop2SecretPass',
            }),
          ],
        },
        ipv6Policy: 'block',
        geo: { mode: 'manual', timezone: 'UTC', language: 'en-US', lat: null, lon: null },
        fingerprint: id.fingerprint,
        startup: { urls: [], restoreTabs: false },
      });

      const raw = dbCtx.db.select().from(profilesTable).all()[0]?.proxyJson ?? '';
      expect(raw).not.toContain('MySecretSshPassword');
      expect(raw).not.toContain('SECRET_KEY_BODY');
      expect(raw).not.toContain('11111111-2222-3333-4444-555555555555');
      expect(raw).not.toContain('Hop2SecretPass');

      const loaded = service.getById(created.id);
      expect(loaded?.proxy.password).toBe('MySecretSshPassword');
      expect(loaded?.proxy.privateKey).toContain('SECRET_KEY_BODY');
      expect(loaded?.proxy.extra?.['uuid']).toBe('11111111-2222-3333-4444-555555555555');
      expect(loaded?.proxy.chain?.[0]?.password).toBe('Hop2SecretPass');
    } finally {
      dbCtx.sqlite.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
