import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { profilesTable } from '../../electron/db/schema';
import { SecretService } from '../../electron/services/secretService';
import { ProfileService } from '../../electron/services/profileService';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antidetect-profile-svc-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Unit: profileService (SQLite in-memory)', () => {
  it('tạo, đọc, sửa, nhân bản (id mới, seed mới, thư mục mới) và mã hóa mật khẩu proxy trong DB', () => {
    const profilesRoot = createTempDir();
    const dbCtx = createDatabase(':memory:');
    const secrets = new SecretService(null);
    const service = new ProfileService(dbCtx.db, secrets, profilesRoot);

    const identity = generateConsistentIdentity('windows', 'chrome');
    const created = service.create({
      name: 'Shop Alpha',
      folderId: null,
      status: 'active',
      tags: ['us', 'ads'],
      notes: 'initial',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: identity.browser,
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: {
        type: 'http',
        host: '198.51.100.1',
        port: 8080,
        username: 'u1',
        password: 'PlaintextSecretPassword999',
      },
      ipv6Policy: 'block',
      geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
      fingerprint: identity.fingerprint,
      startup: { urls: [], restoreTabs: false },
    });

    // Verify raw DB column does NOT store plaintext password
    const rawRow = dbCtx.db.select().from(profilesTable).all()[0];
    expect(rawRow?.proxyJson).not.toContain('PlaintextSecretPassword999');

    // Verify decrypted read returns exact password
    expect(service.getById(created.id)?.proxy.password).toBe('PlaintextSecretPassword999');
    expect(fs.existsSync(service.getProfileDir(created.id))).toBe(true);

    // Update
    const updated = service.update({ id: created.id, name: 'Shop Alpha Updated' });
    expect(updated.name).toBe('Shop Alpha Updated');

    // Duplicate
    const copy = service.duplicate(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe('Shop Alpha Updated (Copy)');
    expect(copy.fingerprint.canvasNoiseSeed).not.toBe(created.fingerprint.canvasNoiseSeed);
    expect(fs.existsSync(service.getProfileDir(copy.id))).toBe(true);

    // Permanent delete removes data/profiles/<id>
    service.permanentDelete(copy.id);
    expect(service.getById(copy.id)).toBeNull();
    expect(fs.existsSync(service.getProfileDir(copy.id))).toBe(false);

    dbCtx.sqlite.close();
  });

  it('lọc đúng theo thư mục, thẻ, trạng thái và tìm kiếm không phân biệt hoa thường', () => {
    const profilesRoot = createTempDir();
    const dbCtx = createDatabase(':memory:');
    const service = new ProfileService(dbCtx.db, new SecretService(null), profilesRoot);

    const folderA = service.createFolder('Team A');
    const folderB = service.createFolder('Team B');
    const id1 = generateConsistentIdentity('windows', 'chrome');

    service.create({
      name: 'Facebook Ads VN',
      folderId: folderA.id,
      status: 'active',
      tags: ['fb', 'vn'],
      notes: '',
      platform: id1.platform,
      osVersion: id1.osVersion,
      browser: id1.browser,
      browserVersion: id1.browserVersion,
      userAgent: id1.userAgent,
      proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
      ipv6Policy: 'block',
      geo: { mode: 'auto', timezone: '', language: 'vi-VN', lat: null, lon: null },
      fingerprint: id1.fingerprint,
      startup: { urls: [], restoreTabs: false },
    });

    service.create({
      name: 'TikTok Shop US',
      folderId: folderB.id,
      status: 'warming',
      tags: ['tiktok', 'us'],
      notes: '',
      platform: id1.platform,
      osVersion: id1.osVersion,
      browser: id1.browser,
      browserVersion: id1.browserVersion,
      userAgent: id1.userAgent,
      proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
      ipv6Policy: 'block',
      geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
      fingerprint: id1.fingerprint,
      startup: { urls: [], restoreTabs: false },
    });

    expect(service.list({ folderId: folderA.id })).toHaveLength(1);
    expect(service.list({ tag: 'tiktok' })).toHaveLength(1);
    expect(service.list({ status: 'warming' })).toHaveLength(1);
    expect(service.list({ search: 'facebook ads' })).toHaveLength(1);
    expect(service.list({ search: 'TIKTOK' })).toHaveLength(1);

    dbCtx.sqlite.close();
  });
});
