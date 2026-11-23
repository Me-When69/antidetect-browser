import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptBackupEnvelope,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  stripProxyCredentialsFromBackup,
} from '../../electron/services/backupCrypto';
import { createDatabase } from '../../electron/db';
import { ProfileService } from '../../electron/services/profileService';
import { SecretService } from '../../electron/services/secretService';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import type { BackupPayload } from '@shared/types';

describe('PHA 1.2: Encrypted Profile Backup (AES-256-GCM + scrypt + AAD)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      try {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows locks
      }
    }
  });

  function makeSamplePayload(profileCount = 2): BackupPayload {
    const identity = generateConsistentIdentity('windows', 'chrome');
    const profiles = Array.from({ length: profileCount }, (_, i) => ({
      id: `prof-${i + 1}`,
      name: `Profile #${i + 1}`,
      folderId: null,
      status: 'ready' as const,
      tags: ['qa'],
      notes: 'Synthetic test profile',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: identity.browser,
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: {
        type: 'http' as const,
        host: '127.0.0.1',
        port: 8080,
        username: 'mockuser',
        password: 'MockProxyPassword!123',
      },
      ipv6Policy: 'block' as const,
      geo: {
        mode: 'manual' as const,
        timezone: 'Asia/Ho_Chi_Minh',
        language: 'vi-VN',
        lat: null,
        lon: null,
      },
      fingerprint: identity.fingerprint,
      startup: { urls: [], restoreTabs: false },
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      deletedAt: null,
    }));

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: [],
      tags: [],
      proxies: [
        {
          id: 'px-1',
          name: 'Local Proxy',
          type: 'http',
          host: '127.0.0.1',
          port: 8080,
          username: 'mockuser',
          password: 'MockProxyPassword!123',
          country: 'VN',
          createdAt: new Date().toISOString(),
        },
      ],
      profiles,
    };
  }

  it('encrypts and decrypts backup payload, rejects wrong password, 1-byte tamper, and swapped fields', () => {
    const payload = makeSamplePayload(2);
    const envelope = encryptBackupPayload(payload, 'BackupMaster!2026');
    expect(isEncryptedBackupEnvelope(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('MockProxyPassword!123');

    // Correct password succeeds
    const decoded = decryptBackupEnvelope(envelope, 'BackupMaster!2026');
    expect(decoded.profiles).toHaveLength(2);
    expect(decoded.profiles[0]?.proxy.password).toBe('MockProxyPassword!123');

    // Wrong password fails
    expect(() => decryptBackupEnvelope(envelope, 'WrongPassword!1')).toThrow(/Sai mật khẩu/);

    // 1-byte tamper in ciphertext fails
    const ctBuf = Buffer.from(envelope.ciphertext, 'base64');
    ctBuf[0] = (ctBuf[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptBackupEnvelope(
        { ...envelope, ciphertext: ctBuf.toString('base64') },
        'BackupMaster!2026',
      ),
    ).toThrow(/Sai mật khẩu|chỉnh sửa/);

    // Swapped nonce / version (AAD) fails
    const envelope2 = encryptBackupPayload(payload, 'BackupMaster!2026');
    expect(() =>
      decryptBackupEnvelope({ ...envelope, nonce: envelope2.nonce }, 'BackupMaster!2026'),
    ).toThrow(/Sai mật khẩu|chỉnh sửa/);
  });

  it('strips all proxy passwords & credentials when excludeProxyPasswords is enabled', () => {
    const payload = makeSamplePayload(2);
    const stripped = stripProxyCredentialsFromBackup(payload);
    expect(JSON.stringify(stripped)).not.toContain('MockProxyPassword!123');
    expect(JSON.stringify(stripped)).not.toContain('mockuser');
    expect(stripped.profiles[0]?.proxy.password).toBe('');
    expect(stripped.proxies[0]?.password).toBe('');
  });

  it('handles large backup (500 profiles), backward-compatible legacy plaintext JSON, and never overwrites duplicate profiles', () => {
    const large = makeSamplePayload(500);
    const env = encryptBackupPayload(large, 'LargeBackupPass!1');
    const decrypted = decryptBackupEnvelope(env, 'LargeBackupPass!1');
    expect(decrypted.profiles).toHaveLength(500);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-bkp-import-'));
    tempDirs.push(dir);
    const dbCtx = createDatabase(path.join(dir, 'antidetect.db'));
    const svc = new ProfileService(dbCtx.db, new SecretService(), path.join(dir, 'profiles'));

    // Import legacy plaintext JSON directly
    const legacy = makeSamplePayload(2);
    const first = svc.importBackup(legacy);
    expect(first.profiles).toBe(2);

    // Import encrypted envelope with same profile IDs -> skips duplicates (does NOT overwrite!)
    const encrypted = encryptBackupPayload(
      { ...legacy, profiles: legacy.profiles.map((p) => ({ ...p, name: 'OVERWRITTEN' })) },
      'Pass!1234',
    );
    const second = svc.importBackup(encrypted, 'Pass!1234');
    expect(second.profiles).toBe(0);
    expect(svc.getById('prof-1')?.name).toBe('Profile #1');

    dbCtx.sqlite.close();
  });
});
