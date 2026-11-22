import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/db';
import { SecretService } from '../electron/services/secretService';
import { ProfileService } from '../electron/services/profileService';
import { ProxyService } from '../electron/services/proxyService';
import { SettingsService } from '../electron/services/settingsService';
import { AppLogger } from '../electron/services/logger';
import { ProfileLauncher } from '../electron/services/launcher';
import { LocalApiServer } from '../electron/services/localApi';
import {
  generateConsistentIdentity,
  listDevicePresets,
} from '../electron/services/fingerprint/generator';
import { buildFingerprintInitScript } from '../electron/services/fingerprint/injector';
import {
  checkIdentityConsistency,
  parseCookiesText,
  parseProfilesCsv,
  parseQuickProxy,
  serializeCookiesNetscape,
} from '@shared/validation';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-test-'));
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
        // Ignore locked sqlite handles on Windows
      }
    }
  }
});

describe('Step 1 & 9: Database, ProfileService CRUD, Bulk & Backup', () => {
  it('creates, updates, duplicates, filters, bulk creates, and backs up profiles', () => {
    const dir = createTempDir();
    const dbCtx = createDatabase(path.join(dir, 'test.db'));
    const secrets = new SecretService(null);
    const service = new ProfileService(dbCtx.db, secrets, path.join(dir, 'profiles'));

    const folder = service.createFolder('Team Ads');
    const identity = generateConsistentIdentity('windows', 'chrome');

    const created = service.create({
      name: 'Account 01',
      folderId: folder.id,
      status: 'active',
      tags: ['fb', 'vip'],
      notes: 'test note',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: identity.browser,
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: { type: 'http', host: '1.2.3.4', port: 8080, username: 'u', password: 'secret' },
      ipv6Policy: 'block',
      geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
      fingerprint: identity.fingerprint,
      startup: { urls: ['https://example.com'], restoreTabs: false },
    });

    expect(service.getById(created.id)?.proxy.password).toBe('secret');

    const dup = service.duplicate(created.id);
    expect(dup.name).toBe('Account 01 (Copy)');
    expect(dup.id).not.toBe(created.id);

    const bulk = service.bulkCreate({
      baseName: 'Batch',
      count: 5,
      template: {
        ...created,
      },
      proxyList: ['10.0.0.1:8080:usr:pwd'],
    });
    expect(bulk).toHaveLength(5);
    expect(bulk[0]?.proxy.host).toBe('10.0.0.1');

    const filtered = service.list({ folderId: folder.id, search: 'Account 01' });
    expect(filtered.length).toBeGreaterThanOrEqual(2);

    const backup = service.exportBackup();
    expect(backup.profiles.length).toBe(7);
    expect(backup.folders.length).toBe(1);

    dbCtx.sqlite.close();
  });
});

describe('Step 4 & 9: Proxy & Cookie Parsers', () => {
  it('parses host:port:user:pass and URL formats', () => {
    const p1 = parseQuickProxy('192.168.1.5:8080:alice:p@ss:word');
    expect(p1).toEqual({
      type: 'http',
      host: '192.168.1.5',
      port: 8080,
      username: 'alice',
      password: 'p@ss:word',
    });

    const p2 = parseQuickProxy('socks5://bob:1234@10.0.0.2:1080');
    expect(p2).toEqual({
      type: 'socks5',
      host: '10.0.0.2',
      port: 1080,
      username: 'bob',
      password: '1234',
    });
  });

  it('parses and serializes cookies in JSON and Netscape formats', () => {
    const jsonCookies = parseCookiesText(
      JSON.stringify([
        { name: 'sid', value: 'abc123', domain: '.example.com', path: '/', secure: true },
      ]),
    );
    expect(jsonCookies).toHaveLength(1);
    const netscape = serializeCookiesNetscape(jsonCookies);
    const reparsed = parseCookiesText(netscape);
    expect(reparsed[0]?.name).toBe('sid');
    expect(reparsed[0]?.value).toBe('abc123');
  });
});

describe('Step 6, 7 & 8: Fingerprint Consistency, Injector & Identity Checker', () => {
  it('provides at least 30 realistic presets and generates 20 consistent Windows profiles', () => {
    expect(listDevicePresets().length).toBeGreaterThanOrEqual(30);

    for (let i = 0; i < 20; i += 1) {
      const id = generateConsistentIdentity('windows', 'chrome');
      expect(id.userAgent).toMatch(/Windows NT/);
      expect(id.fingerprint.webgl.renderer.toLowerCase()).not.toContain('apple');
      expect(id.fingerprint.fonts).not.toContain('San Francisco');

      const report = checkIdentityConsistency({
        platform: id.platform,
        userAgent: id.userAgent,
        proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
        geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
        fingerprint: id.fingerprint,
      });
      expect(report.ok).toBe(true);
      expect(report.score).toBe(100);
    }
  });

  it('detects OS/GPU/WebRTC/Timezone mismatches', () => {
    const report = checkIdentityConsistency(
      {
        platform: 'windows',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0',
        proxy: { type: 'http', host: '1.1.1.1', port: 8080, username: '', password: '' },
        geo: {
          mode: 'manual',
          timezone: 'Asia/Ho_Chi_Minh',
          language: 'vi-VN',
          lat: null,
          lon: null,
        },
        fingerprint: {
          screen: { width: 1920, height: 1080, dpr: 1 },
          hardware: { cores: 8, memory: 16 },
          webgl: { vendor: 'Apple', renderer: 'Apple M3 Pro' },
          canvasNoiseSeed: 123,
          audioNoiseSeed: 456,
          fonts: ['San Francisco'],
          webrtc: 'real',
        },
      },
      {
        ok: true,
        ip: '8.8.8.8',
        country: 'United States',
        countryCode: 'US',
        city: 'New York',
        timezone: 'America/New_York',
        lat: 40.7,
        lon: -74.0,
        language: 'en-US',
        latencyMs: 50,
      },
    );

    const codes = report.warnings.map((w) => w.code);
    expect(codes).toContain('UA_OS_MISMATCH');
    expect(codes).toContain('GPU_OS_MISMATCH');
    expect(codes).toContain('FONT_OS_MISMATCH');
    expect(codes).toContain('WEBRTC_LEAK_RISK');
    expect(codes).toContain('TIMEZONE_IP_MISMATCH');
    expect(codes).toContain('LANGUAGE_IP_MISMATCH');
    expect(report.ok).toBe(false);
  });

  it('generates valid fingerprint injector script with native toString masking', () => {
    const id = generateConsistentIdentity('windows', 'chrome');
    const script = buildFingerprintInitScript({
      id: 'p1',
      name: 'Test',
      folderId: null,
      status: 'none',
      tags: [],
      notes: '',
      platform: id.platform,
      osVersion: id.osVersion,
      browser: id.browser,
      browserVersion: id.browserVersion,
      userAgent: id.userAgent,
      proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
      ipv6Policy: 'block',
      geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
      fingerprint: id.fingerprint,
      startup: { urls: [], restoreTabs: false },
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      deletedAt: null,
    });
    expect(script).toContain('[native code]');
    expect(script).toContain('hardwareConcurrency');
    expect(script).toContain('RTCPeerConnection');
  });
});

describe('Step 10: Local REST API Server', () => {
  it('enforces API key authentication and supports GET/POST /profiles on 127.0.0.1', async () => {
    const dir = createTempDir();
    const dbCtx = createDatabase(path.join(dir, 'api.db'));
    const secrets = new SecretService(null);
    const logger = new AppLogger(path.join(dir, 'logs'));
    const profileService = new ProfileService(dbCtx.db, secrets, path.join(dir, 'profiles'));
    const proxyService = new ProxyService(dbCtx.db, secrets);
    const settingsService = new SettingsService(dbCtx.db);
    const launcher = new ProfileLauncher(profileService, proxyService, settingsService, logger);
    const apiServer = new LocalApiServer(profileService, launcher, settingsService, logger);

    const port = await apiServer.start(0);
    const apiKey = settingsService.getSettings().localApiKey;

    try {
      const unauth = await fetch(`http://127.0.0.1:${port}/profiles`);
      expect(unauth.status).toBe(401);

      const createRes = await fetch(`http://127.0.0.1:${port}/profiles`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'API Profile', platform: 'macos', browser: 'firefox' }),
      });
      expect(createRes.status).toBe(201);

      const listRes = await fetch(`http://127.0.0.1:${port}/profiles`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(listRes.status).toBe(200);
      const data = (await listRes.json()) as { profiles: { name: string }[] };
      expect(data.profiles).toHaveLength(1);
      expect(data.profiles[0]?.name).toBe('API Profile');
    } finally {
      await apiServer.stop();
      dbCtx.sqlite.close();
    }
  });
});

describe('Stealth Emerald Upgrade: Trash, CSV Import & Theme Settings', () => {
  it('supports soft-delete to Trash, restore, permanent delete, and CSV import', () => {
    const dir = createTempDir();
    const dbCtx = createDatabase(path.join(dir, 'trash.db'));
    const secrets = new SecretService(null);
    const service = new ProfileService(dbCtx.db, secrets, path.join(dir, 'profiles'));

    const csv = [
      'name,proxy,tags,notes,platform,browser',
      'Shop US 1,1.2.3.4:8080:u1:p1,us;shop,note1,windows,chrome',
      'Mac QA 2,socks5://u2:p2@5.6.7.8:1080,qa,note2,macos,firefox',
    ].join('\n');

    const parsed = parseProfilesCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.platform).toBe('macos');
    expect(parsed[1]?.browser).toBe('firefox');

    const imported = service.importCsv(csv);
    expect(imported).toHaveLength(2);
    expect(service.list()).toHaveLength(2);

    // Soft-delete moves to trash
    service.delete(imported[0]!.id);
    expect(service.list()).toHaveLength(1);
    expect(service.listTrash()).toHaveLength(1);

    // Restore brings it back
    service.restore(imported[0]!.id);
    expect(service.list()).toHaveLength(2);
    expect(service.listTrash()).toHaveLength(0);

    // Soft-delete again and empty trash
    service.delete(imported[1]!.id);
    expect(service.emptyTrash()).toBe(1);
    expect(service.listTrash()).toHaveLength(0);

    const settings = new SettingsService(dbCtx.db);
    expect(settings.getSettings().theme).toBe('dark');
    settings.updateSettings({ theme: 'light' });
    expect(settings.getSettings().theme).toBe('light');

    dbCtx.sqlite.close();
  });
});
