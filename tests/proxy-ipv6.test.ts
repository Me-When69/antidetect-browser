import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/db';
import { SecretService } from '../electron/services/secretService';
import { parseProxy } from '../electron/services/proxyParser';
import {
  detectIpVersion,
  evaluateIpv6Leak,
  ProxyService,
  type ProxyHttpFetcher,
} from '../electron/services/proxyService';
import type { ProfileProxy } from '@shared/types';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-ipv6-'));
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
        // Ignore locked handles on Windows
      }
    }
  }
});

describe('IPv6 Proxy Parsing (parseProxy + net.isIP)', () => {
  it('parses bracketed IPv6 in [addr]:port and scheme://user:pass@[addr]:port forms', () => {
    const r1 = parseProxy('[::1]:8080');
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.hostIpVersion).toBe(6);
      expect(r1.proxy).toEqual({
        type: 'http',
        host: '::1',
        port: 8080,
        username: '',
        password: '',
      });
    }

    const r2 = parseProxy('socks5://alice:s3cr3t@[2001:db8::1]:1080');
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.hostIpVersion).toBe(6);
      expect(r2.proxy).toEqual({
        type: 'socks5',
        host: '2001:db8::1',
        port: 1080,
        username: 'alice',
        password: 's3cr3t',
      });
    }
  });

  it('rejects unbracketed IPv6 with clear Vietnamese guidance', () => {
    const r1 = parseProxy('2001:db8::1:8080');
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error).toContain('ngoặc vuông');
    }

    const r2 = parseProxy('http://user:pass@::1:8080');
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toContain('ngoặc vuông');
    }
  });

  it('parses IPv4 and hostname formats and classifies hostIpVersion correctly', () => {
    const v4 = parseProxy('192.168.10.2:8080:usr:pwd');
    expect(v4.ok).toBe(true);
    if (v4.ok) {
      expect(v4.hostIpVersion).toBe(4);
      expect(v4.proxy.host).toBe('192.168.10.2');
      expect(v4.proxy.username).toBe('usr');
      expect(v4.proxy.password).toBe('pwd');
    }

    const host = parseProxy('proxy.example.com:3128:bob:pass');
    expect(host.ok).toBe(true);
    if (host.ok) {
      expect(host.hostIpVersion).toBe(0);
      expect(host.proxy.host).toBe('proxy.example.com');
    }
  });
});

describe('IPv6 checkProxy ipVersion classification, timezone fallback & leak evaluation', () => {
  it('classifies ipVersion 4 vs 6 via net.isIP', () => {
    expect(detectIpVersion('203.0.113.10')).toBe(4);
    expect(detectIpVersion('2001:db8:85a3::8a2e:370:7334')).toBe(6);
    expect(detectIpVersion('not-an-ip')).toBeUndefined();
  });

  it('returns ipVersion=6 and falls back to next API when first API omits timezone for IPv6', async () => {
    const dir = createTempDir();
    const dbCtx = createDatabase(path.join(dir, 'v6.db'));
    const secrets = new SecretService(null);

    let calls = 0;
    const mockFetcher: ProxyHttpFetcher = async (url) => {
      calls += 1;
      if (url.includes('ipapi.co')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ip: '2001:db8::42',
            country_name: 'Germany',
            country_code: 'DE',
            city: 'Frankfurt',
            timezone: '', // Missing timezone for IPv6!
            latitude: 50.1109,
            longitude: 8.6821,
          }),
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'success',
          query: '2001:db8::42',
          country: 'Germany',
          countryCode: 'DE',
          city: 'Frankfurt',
          timezone: 'Europe/Berlin',
          lat: 50.1109,
          lon: 8.6821,
        }),
      };
    };

    const service = new ProxyService(dbCtx.db, secrets, mockFetcher);
    const proxy: ProfileProxy = {
      type: 'http',
      host: '2001:db8::1',
      port: 8080,
      username: '',
      password: '',
    };

    const res = await service.checkProxy(proxy);
    expect(res.ok).toBe(true);
    expect(res.ip).toBe('2001:db8::42');
    expect(res.ipVersion).toBe(6);
    expect(res.timezone).toBe('Europe/Berlin');
    expect(calls).toBe(2);

    dbCtx.sqlite.close();
  });

  it('flags IPv6 leak when browser sees an IPv6 address different from proxy IP', () => {
    const leaked = evaluateIpv6Leak('203.0.113.5', '2402:800:6340::1234', '203.0.113.5');
    expect(leaked.leaked).toBe(true);
    expect(leaked.warning).toContain('rò rỉ IPv6');

    const safe = evaluateIpv6Leak('', '2001:db8::42', '2001:db8::42');
    expect(safe.leaked).toBe(false);
    expect(safe.warning).toBeUndefined();
  });
});
