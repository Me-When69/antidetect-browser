import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/db';
import { SecretService } from '../electron/services/secretService';
import {
  classifyProxyError,
  ProxyService,
  type ProxyHttpFetcher,
} from '../electron/services/proxyService';
import { deriveGeo, mapCountryToLocale } from '../electron/services/geoService';
import { generateConsistentIdentity } from '../electron/services/fingerprint/generator';
import { buildFingerprintInitScript } from '../electron/services/fingerprint/injector';
import { parseQuickProxy } from '@shared/validation';
import type { ProfileProxy } from '@shared/types';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-proxy-geo-'));
  tempDirs.push(dir);
  return dir;
}

function findLocalChromeForTest(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [
          `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['LOCALAPPDATA'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
  return candidates.find((c) => c && fs.existsSync(c));
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

describe('Part E — Unit tests: parseQuickProxy', () => {
  it('parses host:port, host:port:user:pass, and protocol URLs', () => {
    expect(parseQuickProxy('1.2.3.4:8080')).toEqual({
      type: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: '',
      password: '',
    });
    expect(parseQuickProxy('1.2.3.4:8080:myuser:my:pass')).toEqual({
      type: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: 'myuser',
      password: 'my:pass',
    });
    expect(parseQuickProxy('socks5://u1:p1@9.8.7.6:1080')).toEqual({
      type: 'socks5',
      host: '9.8.7.6',
      port: 1080,
      username: 'u1',
      password: 'p1',
    });
    expect(parseQuickProxy('invalid-string')).toBeNull();
  });
});

describe('Part E — Unit tests: deriveGeo & localeMap', () => {
  it('maps country codes to expected locale and Accept-Language', () => {
    expect(mapCountryToLocale('VN')).toEqual({
      locale: 'vi-VN',
      acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
    });
    expect(mapCountryToLocale('JP').locale).toBe('ja-JP');
    expect(mapCountryToLocale('DE').locale).toBe('de-DE');
    expect(mapCountryToLocale('ZZ').locale).toBe('en-US');
  });

  it('derives timezone from lat/lon via tz-lookup when timezone is missing and applies deterministic geo noise', () => {
    const info = { countryCode: 'VN', timezone: '', lat: 10.8231, lon: 106.6297 };
    const g1 = deriveGeo(info, 'profile-alpha');
    const g2 = deriveGeo(info, 'profile-alpha');
    const g3 = deriveGeo(info, 'profile-beta');

    expect(g1.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(g1.locale).toBe('vi-VN');
    expect(g1.acceptLanguage).toBe('vi-VN,vi;q=0.9,en;q=0.8');

    // Deterministic per profileId, ~±0.01 degrees
    expect(g1.geolocation).toEqual(g2.geolocation);
    expect(g1.geolocation).not.toEqual(g3.geolocation);
    expect(Math.abs((g1.geolocation?.latitude ?? 0) - 10.8231)).toBeLessThanOrEqual(0.01);
    expect(Math.abs((g1.geolocation?.longitude ?? 0) - 106.6297)).toBeLessThanOrEqual(0.01);
  });
});

describe('Part E — Unit tests: Proxy error classification, fallback APIs & 10m cache', () => {
  it('classifies ECONNREFUSED, ETIMEDOUT, ENOTFOUND, and 407 in Vietnamese without leaking passwords', () => {
    const eRefused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(classifyProxyError(eRefused)).toBe(
      'Proxy từ chối kết nối, kiểm tra host/port hoặc dịch vụ proxy',
    );

    const eTimeout = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(classifyProxyError(eTimeout)).toBe('Hết thời gian chờ, proxy chậm hoặc bị chặn');

    const eNotFound = Object.assign(new Error('getaddrinfo ENOTFOUND bad.host'), {
      code: 'ENOTFOUND',
    });
    expect(classifyProxyError(eNotFound)).toBe('Không tìm thấy host proxy');

    expect(classifyProxyError(null, 407)).toBe('Sai tài khoản/mật khẩu hoặc chưa whitelist IP');

    const leaked = classifyProxyError(
      new Error('Failed via http://alice:SuperSecret@1.2.3.4:8080'),
    );
    expect(leaked).not.toContain('SuperSecret');
  });

  it('falls back across 3 APIs and caches results for 10 minutes', async () => {
    const dir = createTempDir();
    const dbCtx = createDatabase(path.join(dir, 'proxy.db'));
    const secrets = new SecretService(null);

    let callCount = 0;
    const mockFetcher: ProxyHttpFetcher = async (url) => {
      callCount += 1;
      if (url.includes('ipapi.co')) {
        return { statusCode: 429, body: JSON.stringify({ error: true }) };
      }
      if (url.includes('ip-api.com')) {
        return { statusCode: 503, body: 'Service Unavailable' };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          ip: '203.0.113.42',
          country: 'Vietnam',
          country_code: 'VN',
          city: 'Ho Chi Minh City',
          latitude: 10.8231,
          longitude: 106.6297,
          timezone: { id: 'Asia/Ho_Chi_Minh' },
        }),
      };
    };

    const proxyService = new ProxyService(dbCtx.db, secrets, mockFetcher);
    const proxy: ProfileProxy = {
      type: 'http',
      host: '127.0.0.1',
      port: 8888,
      username: 'u',
      password: 'p',
    };

    const first = await proxyService.checkProxy(proxy);
    expect(first.ok).toBe(true);
    expect(first.ip).toBe('203.0.113.42');
    expect(first.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(callCount).toBe(3);

    // Second call hits 10-minute cache
    const second = await proxyService.checkProxy(proxy);
    expect(second.ip).toBe('203.0.113.42');
    expect(callCount).toBe(3);

    dbCtx.sqlite.close();
  });
});

describe('Part E — Integration test: Browser timezone & locale override (main frame + iframe)', () => {
  it('applies CDP timezone/locale override and initScript so Intl timezone and navigator.language match', async () => {
    const executablePath = findLocalChromeForTest();
    const dir = createTempDir();
    const identity = generateConsistentIdentity('windows', 'chrome');
    const derived = deriveGeo(
      { countryCode: 'VN', timezone: 'Asia/Ho_Chi_Minh', lat: 10.8231, lon: 106.6297 },
      'integration-profile-1',
    );

    const resolvedGeo = {
      timezone: derived.timezone,
      language: derived.locale,
      acceptLanguage: derived.acceptLanguage,
      lat: derived.geolocation?.latitude ?? null,
      lon: derived.geolocation?.longitude ?? null,
      accuracy: derived.geolocation?.accuracy ?? 50,
    };

    const context = await chromium.launchPersistentContext(path.join(dir, 'user-data'), {
      headless: true,
      executablePath,
      permissions: ['geolocation'],
    });

    try {
      await context.setExtraHTTPHeaders({ 'Accept-Language': resolvedGeo.acceptLanguage });
      await context.addInitScript(
        buildFingerprintInitScript(
          {
            id: 'integration-profile-1',
            name: 'Integration Test',
            folderId: null,
            status: 'none',
            tags: [],
            notes: '',
            platform: identity.platform,
            osVersion: identity.osVersion,
            browser: identity.browser,
            browserVersion: identity.browserVersion,
            userAgent: identity.userAgent,
            proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
            ipv6Policy: 'block',
            geo: {
              mode: 'auto',
              timezone: resolvedGeo.timezone,
              language: resolvedGeo.language,
              lat: resolvedGeo.lat,
              lon: resolvedGeo.lon,
            },
            fingerprint: identity.fingerprint,
            startup: { urls: [], restoreTabs: false },
            createdAt: new Date().toISOString(),
            lastRunAt: null,
            deletedAt: null,
          },
          resolvedGeo,
        ),
      );

      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: resolvedGeo.timezone });
      await cdp.send('Emulation.setLocaleOverride', { locale: resolvedGeo.language });
      if (resolvedGeo.lat !== null && resolvedGeo.lon !== null) {
        await cdp.send('Emulation.setGeolocationOverride', {
          latitude: resolvedGeo.lat,
          longitude: resolvedGeo.lon,
          accuracy: resolvedGeo.accuracy,
        });
      }

      await page.setContent(`
          <!doctype html>
          <html><body>
            <iframe id="child" srcdoc="<!doctype html><html><body>frame</body></html>"></iframe>
          </body></html>
        `);

      const mainResult = await page.evaluate(() => ({
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language,
      }));

      expect(mainResult.tz).toBe('Asia/Ho_Chi_Minh');
      expect(mainResult.lang).toBe('vi-VN');

      const childFrame = page.frames().find((f) => f !== page.mainFrame());
      expect(childFrame).toBeDefined();
      const iframeResult = await childFrame!.evaluate(() => ({
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language,
      }));

      expect(iframeResult.tz).toBe('Asia/Ho_Chi_Minh');
      expect(iframeResult.lang).toBe('vi-VN');
    } finally {
      await context.close();
    }
  }, 30_000);
});
