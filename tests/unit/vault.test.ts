import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as fernet from 'fernet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptField,
  encryptField,
  generateDek,
  generateStrongPassword,
} from '../../electron/services/vault/crypto';
import {
  VaultLockedError,
  VaultLockedOutError,
  VaultService,
  WrongPasswordError,
  type VaultSecretField,
} from '../../electron/services/vault/vaultService';
import { generateTotpCode, parseTotpInput } from '../../electron/services/vault/totpService';
import { ClipboardGuard } from '../../electron/services/vault/clipboardGuard';
import { importFromLegacyPythonVault } from '../../electron/services/vault/legacyImport';
import { auditVaultAccounts } from '../../electron/services/vault/securityAudit';
import { redactSensitive } from '../../electron/services/logger';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createLegacyPythonVault(
  dbPath: string,
  masterPassword: string,
  rows: {
    email: string;
    label: string;
    notes: string;
    password: string;
    recovery: string;
    totp: string;
    token?: string;
  }[],
): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE meta (k TEXT PRIMARY KEY, v BLOB);
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        label TEXT,
        notes TEXT,
        password BLOB,
        recovery TEXT,
        totp BLOB,
        pw_updated INTEGER
      );
      CREATE TABLE tokens (email TEXT PRIMARY KEY, token BLOB);
    `);

    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(masterPassword, salt, 32, { N: 16384, r: 8, p: 1 });
    const b64Key = key.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const secret = new fernet.Secret(b64Key);
    const enc = (val: string) => new fernet.Token({ secret }).encode(val);

    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('salt', salt);
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run(
      'check',
      Buffer.from(enc('ok'), 'utf8'),
    );

    const nowSec = Math.floor(Date.now() / 1000);
    for (const r of rows) {
      db.prepare(
        `INSERT INTO accounts (email, label, notes, password, recovery, totp, pw_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        r.email,
        r.label,
        r.notes,
        r.password ? Buffer.from(enc(r.password), 'utf8') : null,
        r.recovery,
        r.totp ? Buffer.from(enc(r.totp), 'utf8') : null,
        nowSec,
      );
      if (r.token) {
        db.prepare('INSERT INTO tokens (email, token) VALUES (?, ?)').run(
          r.email,
          Buffer.from(enc(r.token), 'utf8'),
        );
      }
    }
  } finally {
    db.close();
  }
}

describe('Facet Encrypted Vault & Security Unit Tests', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('encrypts/decrypts fields with AES-256-GCM, rejects tampered ciphertext and wrong AAD', () => {
    const dek = generateDek();
    const aad = 'accounts:row-1:password';
    const blob = encryptField(dek, 'SuperSecret!123', aad)!;

    expect(decryptField(dek, blob, aad)).toBe('SuperSecret!123');
    // Wrong AAD (e.g. swapped row) MUST throw
    expect(() => decryptField(dek, blob, 'accounts:row-2:password')).toThrow();

    // Flip 1 bit in ciphertext -> GCM auth tag check MUST throw
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    expect(() => decryptField(dek, tampered, aad)).toThrow();
  });

  it('rejects row-swapping attack directly inside vault.db SQLite', () => {
    const dir = makeTempDir('facet-vault-aad-');
    cleanupDirs.push(dir);
    const dbPath = path.join(dir, 'vault.db');

    const vault = new VaultService(dbPath);
    vault.unlock('MasterPass#2026');
    vault.addAccount({ email: 'alice@example.com', password: 'AlicePassword!123' });
    vault.addAccount({ email: 'bob@example.com', password: 'BobPassword!456' });
    vault.close();

    // Tamper directly in SQLite: copy Alice's password_enc into Bob's row
    const rawDb = new Database(dbPath);
    const aliceRow = rawDb
      .prepare('SELECT password_enc FROM accounts WHERE email = ?')
      .get('alice@example.com') as { password_enc: Buffer };
    rawDb
      .prepare('UPDATE accounts SET password_enc = ? WHERE email = ?')
      .run(aliceRow.password_enc, 'bob@example.com');
    rawDb.close();

    const vault2 = new VaultService(dbPath);
    vault2.unlock('MasterPass#2026');
    expect(vault2.getAccountSecret('alice@example.com', 'password')).toBe('AlicePassword!123');
    expect(() => vault2.getAccountSecret('bob@example.com', 'password')).toThrow();
    vault2.close();
  });

  it('handles wrong master password, 5-attempt progressive lockout, changeMasterPassword, lock & column allowlist', () => {
    const dir = makeTempDir('facet-vault-lifecycle-');
    cleanupDirs.push(dir);
    const dbPath = path.join(dir, 'vault.db');

    const vault = new VaultService(dbPath);
    vault.unlock('InitialMaster!1');
    const summary = vault.addAccount({
      email: 'user1@example.com',
      label: 'Work',
      password: 'MyStrongPassword!99',
      recovery: 'rec@example.com',
      notes: 'Secret note',
    });

    // Summary must NOT contain plaintext password or secret fields
    expect(JSON.stringify(summary)).not.toContain('MyStrongPassword!99');
    expect(JSON.stringify(summary)).not.toContain('Secret note');

    // Column allowlist rejects SQL injection attempt
    expect(() =>
      vault.getAccountSecret(
        'user1@example.com',
        'password; DROP TABLE accounts;--' as VaultSecretField,
      ),
    ).toThrow();

    // Change master password preserves data
    vault.changeMasterPassword('InitialMaster!1', 'NewMasterPass!2');
    let lockedFired = false;
    vault.onLock(() => {
      lockedFired = true;
    });
    vault.lock();
    expect(lockedFired).toBe(true);
    expect(() => vault.listAccounts()).toThrow(VaultLockedError);

    // Old password fails; 5 consecutive failures trigger progressive lockout
    for (let i = 0; i < 5; i += 1) {
      expect(() => vault.unlock('InitialMaster!1')).toThrow(WrongPasswordError);
    }
    expect(() => vault.unlock('NewMasterPass!2')).toThrow(VaultLockedOutError);
    expect(vault.getStatus().lockedOutRemainingSec).toBeGreaterThan(0);

    // Re-open fresh instance and unlock with new master password
    vault.close();
    const vault2 = new VaultService(dbPath);
    vault2.unlock('NewMasterPass!2');
    expect(vault2.getAccountSecret('user1@example.com', 'password')).toBe('MyStrongPassword!99');
    expect(vault2.getAccountSecret('user1@example.com', 'recovery')).toBe('rec@example.com');
    expect(vault2.getAccountSecret('user1@example.com', 'notes')).toBe('Secret note');
    vault2.close();
  });

  it('generates strong passwords containing all 4 character classes', () => {
    const pw = generateStrongPassword(20);
    expect(pw.length).toBe(20);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
    expect(/[^a-zA-Z0-9]/.test(pw)).toBe(true);
  });

  it('computes RFC 6238 TOTP test vector accurately and parses otpauth:// URIs', () => {
    // RFC 6238 SHA-1 secret "12345678901234567890" in Base32
    const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    // At epoch 59 seconds, 6-digit TOTP is 287082 (last 6 digits of RFC 6238 94287082)
    const result = generateTotpCode(rfcSecret, 59);
    expect(result.code).toBe('287082');
    expect(result.period).toBe(30);
    expect(result.remainingSeconds).toBe(1);

    const parsed = parseTotpInput(
      `otpauth://totp/Google:test%40example.com?secret=${rfcSecret}&issuer=Google&digits=6&period=30`,
    );
    expect(parsed.secret).toBe(rfcSecret);
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
  });

  it('auto-clears clipboard after 20s only if unchanged, and preserves user clipboard if overwritten', () => {
    vi.useFakeTimers();
    let clipText = '';
    const guard = new ClipboardGuard({
      readText: () => clipText,
      writeText: (t) => {
        clipText = t;
      },
    });

    // Case 1: unchanged -> clears after 20s
    guard.copySensitive('SecretPw#1', 20_000);
    expect(clipText).toBe('SecretPw#1');
    vi.advanceTimersByTime(19_999);
    expect(clipText).toBe('SecretPw#1');
    vi.advanceTimersByTime(1);
    expect(clipText).toBe('');

    // Case 2: user copies something else before 20s -> must NOT clear user text
    guard.copySensitive('SecretPw#2', 20_000);
    expect(clipText).toBe('SecretPw#2');
    clipText = 'UserCopiedSomethingElse';
    vi.advanceTimersByTime(25_000);
    expect(clipText).toBe('UserCopiedSomethingElse');

    guard.dispose();
  });

  it('imports accounts & tokens from legacy Python Fernet vault.db with skip/overwrite handling', () => {
    const dir = makeTempDir('facet-legacy-import-');
    cleanupDirs.push(dir);
    const legacyPath = path.join(dir, 'legacy_vault.db');
    const newPath = path.join(dir, 'vault.db');

    createLegacyPythonVault(legacyPath, 'LegacyMaster!99', [
      {
        email: 'legacy1@example.com',
        label: 'OldLabel',
        notes: 'Old secret note',
        password: 'LegacyPassword!1',
        recovery: 'rec1@example.com',
        totp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        token: JSON.stringify({ access_token: 'tok-1', refresh_token: 'ref-1' }),
      },
    ]);

    const vault = new VaultService(newPath);
    vault.unlock('NewFacetMaster!1');

    // Wrong legacy password must throw
    expect(() =>
      importFromLegacyPythonVault(vault, {
        legacyDbPath: legacyPath,
        legacyMasterPassword: 'WrongLegacyPassword',
        overwriteDuplicates: false,
      }),
    ).toThrow(WrongPasswordError);

    // Valid import
    const res1 = importFromLegacyPythonVault(vault, {
      legacyDbPath: legacyPath,
      legacyMasterPassword: 'LegacyMaster!99',
      overwriteDuplicates: false,
    });
    expect(res1.imported).toBe(1);
    expect(res1.tokensImported).toBe(1);
    expect(vault.getAccountSecret('legacy1@example.com', 'password')).toBe('LegacyPassword!1');
    expect(vault.getAccountSecret('legacy1@example.com', 'recovery')).toBe('rec1@example.com');
    expect(vault.getAccountSecret('legacy1@example.com', 'notes')).toBe('Old secret note');
    expect(vault.getOAuthToken('legacy1@example.com')?.tokenJson).toContain('ref-1');

    // Re-import with skip
    const resSkip = importFromLegacyPythonVault(vault, {
      legacyDbPath: legacyPath,
      legacyMasterPassword: 'LegacyMaster!99',
      overwriteDuplicates: false,
    });
    expect(resSkip.skipped).toBe(1);
    expect(resSkip.overwritten).toBe(0);

    // Re-import with overwrite
    const resOverwrite = importFromLegacyPythonVault(vault, {
      legacyDbPath: legacyPath,
      legacyMasterPassword: 'LegacyMaster!99',
      overwriteDuplicates: true,
    });
    expect(resOverwrite.overwritten).toBe(1);
    vault.close();
  });

  it('audits all 7 security rules without ever leaking plaintext passwords', () => {
    const dir = makeTempDir('facet-vault-audit-');
    cleanupDirs.push(dir);
    const dbPath = path.join(dir, 'vault.db');

    const vault = new VaultService(dbPath);
    vault.unlock('AuditMaster!1');

    // Account 1: weak + reused + no 2FA + no recovery + no Gmail API
    vault.addAccount({
      email: 'weak1@example.com',
      password: 'password123',
    });
    // Account 2: reused same weak password + has 2FA + has recovery + expired token
    vault.addAccount({
      email: 'weak2@example.com',
      password: 'password123',
      recovery: 'rec@example.com',
      totp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    });
    vault.setOAuthToken('weak2@example.com', '{"access_token":"x"}', 'gmail.readonly');
    vault.markTokenNeedsReauth('weak2@example.com');

    // Simulate 200 days later so OLD_PASSWORD triggers
    const futureSec = Math.floor(Date.now() / 1000) + 200 * 86400;
    const issues = auditVaultAccounts(vault, futureSec);
    const codes = new Set(issues.map((i) => i.code));

    expect(codes.has('NO_2FA')).toBe(true);
    expect(codes.has('OLD_PASSWORD')).toBe(true);
    expect(codes.has('NO_RECOVERY')).toBe(true);
    expect(codes.has('WEAK_PASSWORD')).toBe(true);
    expect(codes.has('REUSED_PASSWORD')).toBe(true);
    expect(codes.has('NO_GMAIL_API')).toBe(true);
    expect(codes.has('TOKEN_EXPIRED')).toBe(true);

    // Plaintext password MUST NEVER appear in audit output
    expect(JSON.stringify(issues)).not.toContain('password123');
    vault.close();
  });

  it('redacts secrets, tokens, otpauth URIs, and masks emails in logs', () => {
    const raw =
      'Authorized alice.smith@gmail.com password=MySecret123 refresh_token=1//abcDEF otpauth://totp/Google?secret=JBSWY3DPEHPK3PXP Bearer ya29.test_token';
    const safe = redactSensitive(raw);
    expect(safe).toContain('a***@gmail.com');
    expect(safe).not.toContain('alice.smith@gmail.com');
    expect(safe).not.toContain('MySecret123');
    expect(safe).not.toContain('1//abcDEF');
    expect(safe).not.toContain('JBSWY3DPEHPK3PXP');
    expect(safe).not.toContain('ya29.test_token');
  });
});
