import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptBackupEnvelope,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  stripProxyCredentialsFromBackup,
  type EncryptedBackupEnvelope,
} from '../../electron/services/backupCrypto';
import {
  BrowserInstaller,
  classifyInstallError,
  type UtilityProcessLike,
} from '../../electron/services/browserInstaller';
import {
  MIGRATION_MARKER_FILE,
  migrateLegacyUserDataIfNeeded,
} from '../../electron/services/dataMigration';
import { extractEncryptedEmlArchiveToDir } from '../../electron/services/gmail/emlArchive';
import {
  GMAIL_SCOPE_MODIFY,
  GMAIL_SCOPE_READONLY,
  GmailOAuthService,
  resolveAllowedScope,
} from '../../electron/services/gmail/oauthService';
import { AppLogger } from '../../electron/services/logger';
import { ClipboardGuard } from '../../electron/services/vault/clipboardGuard';
import { VaultService } from '../../electron/services/vault/vaultService';

class FakeUtilityProcess extends EventEmitter implements UtilityProcessLike {
  stdout = new PassThrough();
  stderr = new PassThrough();
}

describe('PHA 1.9.4: Edge-case unit coverage (migration, backupCrypto, emlArchive, clipboardGuard, browserInstaller)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('dataMigration handles missing legacyDir, identical existing files, and leftover .tmp recovery', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-mig-edge-'));
    tempDirs.push(root);

    const missingRes = migrateLegacyUserDataIfNeeded(
      path.join(root, 'does-not-exist'),
      path.join(root, 'Facet'),
    );
    expect(missingRes.migrated).toBe(false);
    expect(missingRes.reason).toBe('no-legacy-dir');

    const legacyDir = path.join(root, 'antidetect-app');
    const targetDir = path.join(root, 'Facet');
    fs.mkdirSync(path.join(legacyDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'data', 'same.txt'), 'SAME_CONTENT', 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'bridge-pids.json'), '[42]', 'utf8');

    // Pre-populate identical file + leftover .tmp file (simulating interrupted run)
    fs.mkdirSync(path.join(targetDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'data', 'same.txt'), 'SAME_CONTENT', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'bridge-pids.json.facet-tmp'), 'partial', 'utf8');

    const res = migrateLegacyUserDataIfNeeded(legacyDir, targetDir);
    expect(res.migrated).toBe(true);
    expect(res.filesCopied).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(targetDir, 'bridge-pids.json'), 'utf8')).toBe('[42]');
    expect(fs.existsSync(path.join(targetDir, MIGRATION_MARKER_FILE))).toBe(true);
  });

  it('backupCrypto validates password length, malformed envelopes, and strips proxy credentials cleanly', () => {
    expect(isEncryptedBackupEnvelope(null)).toBe(false);
    expect(isEncryptedBackupEnvelope({ magic: 'WRONG', version: 1 })).toBe(false);
    expect(isEncryptedBackupEnvelope({ magic: 'FACET_BKP', version: 99 })).toBe(false);

    const samplePayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: [],
      tags: [],
      profiles: [],
      proxies: [
        {
          id: 'px-1',
          name: 'Proxy 1',
          type: 'http' as const,
          host: '127.0.0.1',
          port: 8080,
          username: 'demo',
          password: 'secret-proxy-password',
          country: 'US',
          createdAt: new Date().toISOString(),
        },
      ],
    };

    expect(() => encryptBackupPayload(samplePayload, 'abc')).toThrow(/ít nhất 6 ký tự/);
    const badKdfEnv: EncryptedBackupEnvelope = {
      magic: 'FACET_BKP',
      version: 1,
      kdf: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 },
      salt: 'AAAA',
      nonce: 'AAAA',
      tag: 'AAAA',
      ciphertext: 'AAAA',
    };
    expect(() => decryptBackupEnvelope(badKdfEnv, 'ValidPass!1')).toThrow(/Tham số KDF/);
    const badHeaderEnv: EncryptedBackupEnvelope = {
      magic: 'FACET_BKP',
      version: 1,
      kdf: { alg: 'scrypt', N: 32768, r: 8, p: 1, dkLen: 32 },
      salt: 'AAAA',
      nonce: 'AAAA',
      tag: 'AAAA',
      ciphertext: 'AAAA',
    };
    expect(() => decryptBackupEnvelope(badHeaderEnv, 'ValidPass!1')).toThrow(/Header file sao lưu/);

    const stripped = stripProxyCredentialsFromBackup(samplePayload);
    expect(stripped.proxies[0]?.host).toBe('127.0.0.1');
    expect(stripped.proxies[0]?.username).toBe('');
    expect(stripped.proxies[0]?.password).toBe('');
  });

  it('emlArchive throws clear error when archive file does not exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-eml-missing-'));
    tempDirs.push(root);
    expect(() =>
      extractEncryptedEmlArchiveToDir(
        path.join(root, 'missing.facet-eml'),
        path.join(root, 'out'),
        'Pass1234',
      ),
    ).toThrow(/Không tìm thấy tệp sao lưu/);
  });

  it('ClipboardGuard handles Electron 45 async Promise<string> readText, timer auto-clear, user override, and dispose', async () => {
    vi.useFakeTimers();
    let clip = '';
    const guard = new ClipboardGuard({
      readText: () => Promise.resolve(clip),
      writeText: (text) => {
        clip = text;
      },
    });

    // 1. Auto-clears after TTL when unchanged (also tests replacing active timer)
    guard.copySensitive('TempFirst!0', 5000);
    guard.copySensitive('SuperSecret!1', 5000);
    expect(clip).toBe('SuperSecret!1');
    await vi.advanceTimersByTimeAsync(5000);
    expect(clip).toBe('');

    // 2. Does NOT clear if user copied something else before TTL
    guard.copySensitive('SecretTwo!2', 5000);
    expect(clip).toBe('SecretTwo!2');
    clip = 'UserCopiedSomethingElse';
    await vi.advanceTimersByTimeAsync(5000);
    expect(clip).toBe('UserCopiedSomethingElse');

    // 3. dispose() clears immediately when still holding sensitive value
    guard.copySensitive('SecretThree!3', 10000);
    expect(clip).toBe('SecretThree!3');
    guard.dispose();
    await Promise.resolve();
    expect(clip).toBe('');

    // 4. Handles rejected readText() promise gracefully
    const failingGuard = new ClipboardGuard({
      readText: () => Promise.reject(new Error('clipboard unavailable')),
      writeText: () => {},
    });
    failingGuard.copySensitive('SecretFour!4', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    failingGuard.dispose();
  });

  it('BrowserInstaller uses utilityProcess.fork adapter, parses progress, classifies errors, and guards duplicates', async () => {
    expect(classifyInstallError('ENOSPC: no space left on device')).toMatch(/dung lượng trống/);
    expect(classifyInstallError('EACCES: permission denied')).toMatch(/antivirus|quyền ghi/);
    expect(classifyInstallError('ECONNREFUSED 127.0.0.1')).toMatch(/kết nối mạng/);
    expect(classifyInstallError('')).toMatch(/thất bại/);
    expect(classifyInstallError('x'.repeat(250)).endsWith('...')).toBe(true);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-inst-'));
    tempDirs.push(root);
    const cliDir = path.join(root, 'node_modules', 'playwright-core');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, 'cli.js'), '// mock cli', 'utf8');
    const browsersDir = path.join(root, 'browsers');
    const logger = new AppLogger(path.join(root, 'logs'));

    // 1. Success flow + progress parsing + duplicate install guard
    let activeChild: FakeUtilityProcess | null = null;
    const installer = new BrowserInstaller(root, browsersDir, logger, () => {
      activeChild = new FakeUtilityProcess();
      return activeChild;
    });

    const events: { percent: number | null; done?: boolean; success?: boolean }[] = [];
    const installPromise = installer.install('chromium', (ev) => {
      events.push({ percent: ev.percent, done: ev.done, success: ev.success });
    });

    expect(installer.isInstalling('chromium')).toBe(true);
    const dupRes = await installer.install('chromium', () => {});
    expect(dupRes.ok).toBe(false);
    expect(dupRes.error).toMatch(/Đang tải/);

    activeChild!.stdout.write('Downloading Chromium 45%\nDownloading Chromium 90%\n');
    activeChild!.emit('exit', 0);
    const okRes = await installPromise;
    expect(okRes.ok).toBe(true);
    expect(installer.isInstalling('chromium')).toBe(false);
    expect(events.some((e) => e.percent === 45)).toBe(true);
    expect(events.some((e) => e.done && e.success)).toBe(true);

    // 2. Non-zero exit with ENOSPC stderr
    const failPromise = installer.install('firefox', () => {});
    activeChild!.stderr.write('Error: ENOSPC: no space left on device\n');
    activeChild!.emit('exit', 1);
    const failRes = await failPromise;
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toMatch(/dung lượng trống/);

    // 3. UtilityProcess fatal error event
    const errPromise = installer.install('firefox', () => {});
    activeChild!.emit('error', 'FatalError', 'v8', 'EACCES access is denied');
    const errRes = await errPromise;
    expect(errRes.ok).toBe(false);
    expect(errRes.error).toMatch(/antivirus|quyền ghi/);

    // 4. Synchronous fork exception
    const throwingInstaller = new BrowserInstaller(root, browsersDir, logger, () => {
      throw new Error('ECONNREFUSED');
    });
    const throwRes = await throwingInstaller.install('chromium', () => {});
    expect(throwRes.ok).toBe(false);
    expect(throwRes.error).toMatch(/kết nối mạng/);
  });

  it('GmailOAuthService enforces allowed scopes and revokes tokens online + offline fallback', async () => {
    expect(resolveAllowedScope(false)).toBe(GMAIL_SCOPE_READONLY);
    expect(resolveAllowedScope(true)).toBe(GMAIL_SCOPE_MODIFY);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-oauth-unit-'));
    tempDirs.push(root);
    const vault = new VaultService(path.join(root, 'vault.db'));
    let srv: http.Server | null = null;
    try {
      vault.unlock('OAuthUnitMaster!1');
      vault.addAccount({ email: 'rev@example.com', password: 'Password!12345' });
      vault.setOAuthToken(
        'rev@example.com',
        JSON.stringify({
          refresh_token: 'fake-refresh-token-1',
          access_token: 'fake-access-token-1',
          expiry_date: Date.now() + 3600_000,
        }),
        GMAIL_SCOPE_READONLY,
      );

      // Local mock revoke server (zero external network)
      let revokedBody = '';
      srv = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        req.on('end', () => {
          revokedBody = body;
          res.writeHead(200);
          res.end('ok');
        });
      });
      await new Promise<void>((resolve) => srv!.listen(0, '127.0.0.1', () => resolve()));
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      const oauth = new GmailOAuthService(vault, {
        revokeEndpointOverride: `http://127.0.0.1:${port}/revoke`,
      });
      const res1 = await oauth.revokeAccount('rev@example.com');
      expect(res1.remoteRevoked).toBe(true);
      expect(res1.localDeleted).toBe(true);
      expect(revokedBody).toContain('fake-refresh-token-1');
      expect(vault.getOAuthToken('rev@example.com')).toBeNull();

      // Offline / unreachable endpoint still deletes local token
      vault.setOAuthToken(
        'rev@example.com',
        JSON.stringify({
          refresh_token: 'fake-refresh-token-2',
          access_token: 'fake-access-token-2',
          expiry_date: Date.now() + 3600_000,
        }),
        GMAIL_SCOPE_READONLY,
      );
      const offlineOauth = new GmailOAuthService(vault, {
        revokeEndpointOverride: 'http://127.0.0.1:1/revoke',
      });
      const res2 = await offlineOauth.revokeAccount('rev@example.com');
      expect(res2.remoteRevoked).toBe(false);
      expect(res2.localDeleted).toBe(true);
      expect(vault.getOAuthToken('rev@example.com')).toBeNull();

      // Calling revoke when no token exists is safe
      const res3 = await offlineOauth.revokeAccount('rev@example.com');
      expect(res3.localDeleted).toBe(false);
      offlineOauth.dispose();
    } finally {
      srv?.close();
      vault.close();
    }
  });
});
