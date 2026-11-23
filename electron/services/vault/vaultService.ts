import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  VaultAccountCreateInput,
  VaultAccountSummary,
  VaultAccountUpdateInput,
  VaultStatus,
} from '@shared/vaultTypes';
import {
  DEFAULT_KDF_PARAMS,
  decryptField,
  deriveKek,
  encryptField,
  generateDek,
  unwrapDek,
  wrapDek,
  zeroizeBuffer,
  type KdfParams,
} from './crypto';

export class WrongPasswordError extends Error {
  constructor(message = 'Sai mật khẩu chính (master password)') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

export class VaultLockedError extends Error {
  constructor(message = 'Kho tài khoản đang bị khóa, vui lòng mở khóa trước') {
    super(message);
    this.name = 'VaultLockedError';
  }
}

export class VaultLockedOutError extends Error {
  readonly remainingSec: number;
  constructor(remainingSec: number) {
    super(`Nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingSec} giây.`);
    this.name = 'VaultLockedOutError';
    this.remainingSec = remainingSec;
  }
}

export type VaultSecretField = 'password' | 'recovery' | 'totp' | 'notes';

const SECRET_COLUMN_ALLOWLIST: Record<VaultSecretField, string> = {
  password: 'password_enc',
  recovery: 'recovery_enc',
  totp: 'totp_enc',
  notes: 'notes_enc',
};

const CANARY_PLAINTEXT = 'facet-vault-canary-v1';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface AccountRow {
  id: string;
  email: string;
  label: string;
  password_enc: Buffer | null;
  recovery_enc: Buffer | null;
  totp_enc: Buffer | null;
  notes_enc: Buffer | null;
  allow_modify: number;
  pw_updated_at: number;
  created_at: string;
  updated_at: string;
  has_token?: number;
  needs_reauth?: number;
}

export function makeFieldAad(table: string, rowId: string, field: string): string {
  return `${table}:${rowId}:${field}`;
}

export class VaultService {
  private db: Database.Database;
  private dbPath: string;
  private dek: Buffer | null = null;
  private failedAttempts = 0;
  private lockedUntilMs = 0;
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private onLockListeners = new Set<() => void>();

  constructor(vaultDbPath: string) {
    this.dbPath = vaultDbPath;
    const dir = path.dirname(vaultDbPath);
    if (vaultDbPath !== ':memory:' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.db = new Database(vaultDbPath);
    if (vaultDbPath !== ':memory:' && process.platform !== 'win32') {
      try {
        fs.chmodSync(vaultDbPath, 0o600);
      } catch {
        // Ignore permission errors on exotic filesystems
      }
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        password_enc BLOB,
        recovery_enc BLOB,
        totp_enc BLOB,
        notes_enc BLOB,
        allow_modify INTEGER NOT NULL DEFAULT 0,
        pw_updated_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tokens (
        email TEXT PRIMARY KEY,
        token_enc BLOB NOT NULL,
        needs_reauth INTEGER NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secrets (
        k TEXT PRIMARY KEY,
        v_enc BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vault_accounts_email ON accounts (email);
    `);
  }

  close(): void {
    this.lock();
    try {
      this.db.close();
    } catch {
      // Ignore already closed
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }

  onLock(listener: () => void): () => void {
    this.onLockListeners.add(listener);
    return () => {
      this.onLockListeners.delete(listener);
    };
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT v FROM meta WHERE k = ?').get(key) as
      { v: string } | undefined;
    return row ? row.v : null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .run(key, value);
  }

  isInitialized(): boolean {
    return this.getMeta('wrapped_dek') !== null && this.getMeta('salt') !== null;
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  getAutoLockMinutes(): number {
    const raw = Number(this.getMeta('auto_lock_minutes') ?? '10');
    return Number.isFinite(raw) && raw >= 0 ? raw : 10;
  }

  setAutoLockMinutes(minutes: number): void {
    const clamped = Math.max(0, Math.min(240, Math.floor(minutes)));
    this.setMeta('auto_lock_minutes', String(clamped));
    this.resetAutoLockTimer();
  }

  getLockOnMinimize(): boolean {
    return this.getMeta('lock_on_minimize') === '1';
  }

  setLockOnMinimize(enabled: boolean): void {
    this.setMeta('lock_on_minimize', enabled ? '1' : '0');
  }

  getStatus(): VaultStatus {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM accounts').get() as {
      cnt: number;
    };
    const credRow = this.db
      .prepare('SELECT 1 as ok FROM secrets WHERE k = ?')
      .get('google_credentials') as { ok: number } | undefined;
    const now = Date.now();
    const remainingSec =
      this.lockedUntilMs > now ? Math.ceil((this.lockedUntilMs - now) / 1000) : 0;

    return {
      initialized: this.isInitialized(),
      unlocked: this.isUnlocked(),
      lockedOutRemainingSec: remainingSec,
      autoLockMinutes: this.getAutoLockMinutes(),
      lockOnMinimize: this.getLockOnMinimize(),
      hasGoogleCredentials: Boolean(credRow),
      accountCount: countRow.cnt,
    };
  }

  private requireDek(): Buffer {
    if (!this.dek) {
      throw new VaultLockedError();
    }
    this.touchActivity();
    return this.dek;
  }

  touchActivity(): void {
    if (!this.dek) return;
    this.resetAutoLockTimer();
  }

  private resetAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    if (!this.dek) return;
    const mins = this.getAutoLockMinutes();
    if (mins <= 0) return;
    this.autoLockTimer = setTimeout(
      () => {
        this.lock();
      },
      mins * 60 * 1000,
    );
    if (typeof this.autoLockTimer.unref === 'function') {
      this.autoLockTimer.unref();
    }
  }

  lock(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    if (this.dek) {
      zeroizeBuffer(this.dek);
      this.dek = null;
      for (const listener of this.onLockListeners) {
        try {
          listener();
        } catch {
          // Ignore listener errors
        }
      }
    }
  }

  /**
   * Initialize a brand-new vault with a master password, or unlock an existing vault.
   */
  unlock(masterPassword: string): void {
    if (!masterPassword) {
      throw new WrongPasswordError('Mật khẩu chính không được để trống');
    }

    const now = Date.now();
    if (this.lockedUntilMs > now) {
      throw new VaultLockedOutError(Math.ceil((this.lockedUntilMs - now) / 1000));
    }

    if (!this.isInitialized()) {
      const salt = crypto.randomBytes(16);
      const kek = deriveKek(masterPassword, salt, DEFAULT_KDF_PARAMS);
      const dek = generateDek();
      try {
        const wrapped = wrapDek(kek, dek);
        const canary = encryptField(dek, CANARY_PLAINTEXT, 'meta:canary')!;
        const tx = this.db.transaction(() => {
          this.setMeta('kdf_params', JSON.stringify(DEFAULT_KDF_PARAMS));
          this.setMeta('salt', salt.toString('base64'));
          this.setMeta('wrapped_dek', wrapped.toString('base64'));
          this.setMeta('canary', canary.toString('base64'));
          if (this.getMeta('auto_lock_minutes') === null) {
            this.setMeta('auto_lock_minutes', '10');
          }
        });
        tx();
        this.dek = dek;
        this.failedAttempts = 0;
        this.lockedUntilMs = 0;
        this.resetAutoLockTimer();
      } catch (err) {
        zeroizeBuffer(dek);
        throw err;
      } finally {
        zeroizeBuffer(kek);
      }
      return;
    }

    const saltB64 = this.getMeta('salt')!;
    const wrappedB64 = this.getMeta('wrapped_dek')!;
    const canaryB64 = this.getMeta('canary')!;
    const kdfParams = JSON.parse(
      this.getMeta('kdf_params') ?? JSON.stringify(DEFAULT_KDF_PARAMS),
    ) as KdfParams;

    const kek = deriveKek(masterPassword, Buffer.from(saltB64, 'base64'), kdfParams);
    let dek: Buffer | null = null;
    try {
      dek = unwrapDek(kek, Buffer.from(wrappedB64, 'base64'));
      const check = decryptField(dek, Buffer.from(canaryB64, 'base64'), 'meta:canary');
      if (check !== CANARY_PLAINTEXT) {
        throw new WrongPasswordError();
      }
      if (this.dek) {
        zeroizeBuffer(this.dek);
      }
      this.dek = dek;
      dek = null;
      this.failedAttempts = 0;
      this.lockedUntilMs = 0;
      this.resetAutoLockTimer();
    } catch {
      zeroizeBuffer(dek);
      this.failedAttempts += 1;
      if (this.failedAttempts >= 5) {
        const penaltySec = Math.min(300, 5 * 2 ** (this.failedAttempts - 5));
        this.lockedUntilMs = Date.now() + penaltySec * 1000;
      }
      throw new WrongPasswordError();
    } finally {
      zeroizeBuffer(kek);
    }
  }

  /**
   * Verify master password without changing lock state (e.g. for 10s temporary reveal).
   */
  verifyMasterPassword(masterPassword: string): boolean {
    if (!this.isInitialized()) return false;
    const saltB64 = this.getMeta('salt')!;
    const wrappedB64 = this.getMeta('wrapped_dek')!;
    const kdfParams = JSON.parse(
      this.getMeta('kdf_params') ?? JSON.stringify(DEFAULT_KDF_PARAMS),
    ) as KdfParams;
    const kek = deriveKek(masterPassword, Buffer.from(saltB64, 'base64'), kdfParams);
    let dek: Buffer | null = null;
    try {
      dek = unwrapDek(kek, Buffer.from(wrappedB64, 'base64'));
      return true;
    } catch {
      return false;
    } finally {
      zeroizeBuffer(dek);
      zeroizeBuffer(kek);
    }
  }

  /**
   * Atomically re-wrap the existing DEK with a new KEK derived from newPassword.
   * Account rows are NOT re-encrypted.
   */
  changeMasterPassword(oldPassword: string, newPassword: string): void {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Mật khẩu chính mới phải có ít nhất 6 ký tự');
    }
    if (!this.isInitialized()) {
      throw new VaultLockedError('Vault chưa được khởi tạo');
    }
    const oldSaltB64 = this.getMeta('salt')!;
    const oldWrappedB64 = this.getMeta('wrapped_dek')!;
    const oldParams = JSON.parse(
      this.getMeta('kdf_params') ?? JSON.stringify(DEFAULT_KDF_PARAMS),
    ) as KdfParams;

    const oldKek = deriveKek(oldPassword, Buffer.from(oldSaltB64, 'base64'), oldParams);
    let dek: Buffer | null = null;
    let newKek: Buffer | null = null;
    try {
      dek = unwrapDek(oldKek, Buffer.from(oldWrappedB64, 'base64'));
      const newSalt = crypto.randomBytes(16);
      newKek = deriveKek(newPassword, newSalt, DEFAULT_KDF_PARAMS);
      const newWrapped = wrapDek(newKek, dek);

      const tx = this.db.transaction(() => {
        this.setMeta('kdf_params', JSON.stringify(DEFAULT_KDF_PARAMS));
        this.setMeta('salt', newSalt.toString('base64'));
        this.setMeta('wrapped_dek', newWrapped.toString('base64'));
      });
      tx();
    } catch (err) {
      if (err instanceof Error && err.message.includes('ít nhất 6')) throw err;
      throw new WrongPasswordError();
    } finally {
      zeroizeBuffer(oldKek);
      zeroizeBuffer(newKek);
      zeroizeBuffer(dek);
    }
  }

  // ---- Accounts CRUD (envelope AES-256-GCM with row+field AAD) ----

  listAccounts(): VaultAccountSummary[] {
    this.requireDek();
    const rows = this.db
      .prepare(
        `SELECT a.id, a.email, a.label, a.password_enc, a.recovery_enc, a.totp_enc, a.notes_enc,
                a.allow_modify, a.pw_updated_at, a.created_at, a.updated_at,
                CASE WHEN t.email IS NOT NULL THEN 1 ELSE 0 END as has_token,
                COALESCE(t.needs_reauth, 0) as needs_reauth
         FROM accounts a
         LEFT JOIN tokens t ON t.email = a.email
         ORDER BY a.email ASC`,
      )
      .all() as AccountRow[];

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      label: r.label,
      hasPassword: r.password_enc !== null && r.password_enc.length > 0,
      hasRecovery: r.recovery_enc !== null && r.recovery_enc.length > 0,
      hasTotp: r.totp_enc !== null && r.totp_enc.length > 0,
      hasNotes: r.notes_enc !== null && r.notes_enc.length > 0,
      allowModify: r.allow_modify === 1,
      pwUpdatedAt: r.pw_updated_at,
      authorized: r.has_token === 1 && r.needs_reauth !== 1,
      needsReauth: r.has_token === 1 && r.needs_reauth === 1,
      createdAt: r.created_at,
    }));
  }

  addAccount(input: VaultAccountCreateInput): VaultAccountSummary {
    const dek = this.requireDek();
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new Error('Địa chỉ email không hợp lệ');
    }

    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const cleanTotp = (input.totp ?? '').trim();

    this.db
      .prepare(
        `INSERT INTO accounts (
           id, email, label, password_enc, recovery_enc, totp_enc, notes_enc,
           allow_modify, pw_updated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        email,
        (input.label ?? '').trim(),
        encryptField(dek, input.password ?? '', makeFieldAad('accounts', id, 'password')),
        encryptField(dek, (input.recovery ?? '').trim(), makeFieldAad('accounts', id, 'recovery')),
        encryptField(dek, cleanTotp, makeFieldAad('accounts', id, 'totp')),
        encryptField(dek, input.notes ?? '', makeFieldAad('accounts', id, 'notes')),
        input.allowModify ? 1 : 0,
        nowSec,
        nowIso,
        nowIso,
      );

    return {
      id,
      email,
      label: (input.label ?? '').trim(),
      hasPassword: Boolean(input.password),
      hasRecovery: Boolean(input.recovery?.trim()),
      hasTotp: Boolean(cleanTotp),
      hasNotes: Boolean(input.notes),
      allowModify: Boolean(input.allowModify),
      pwUpdatedAt: nowSec,
      authorized: false,
      needsReauth: false,
      createdAt: nowIso,
    };
  }

  updateAccount(input: VaultAccountUpdateInput): VaultAccountSummary {
    const dek = this.requireDek();
    const email = input.email.trim().toLowerCase();
    const existing = this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as
      AccountRow | undefined;
    if (!existing) {
      throw new Error(`Không tìm thấy tài khoản: ${email}`);
    }

    const nowIso = new Date().toISOString();
    const pwChanged = input.password !== undefined;
    const nextPwUpdatedAt = pwChanged ? Math.floor(Date.now() / 1000) : existing.pw_updated_at;

    const nextPasswordEnc = pwChanged
      ? encryptField(dek, input.password ?? '', makeFieldAad('accounts', existing.id, 'password'))
      : existing.password_enc;
    const nextRecoveryEnc =
      input.recovery !== undefined
        ? encryptField(
            dek,
            input.recovery.trim(),
            makeFieldAad('accounts', existing.id, 'recovery'),
          )
        : existing.recovery_enc;
    const nextTotpEnc =
      input.totp !== undefined
        ? encryptField(dek, input.totp.trim(), makeFieldAad('accounts', existing.id, 'totp'))
        : existing.totp_enc;
    const nextNotesEnc =
      input.notes !== undefined
        ? encryptField(dek, input.notes, makeFieldAad('accounts', existing.id, 'notes'))
        : existing.notes_enc;

    const nextLabel = input.label !== undefined ? input.label.trim() : existing.label;
    const nextAllowModify =
      input.allowModify !== undefined ? (input.allowModify ? 1 : 0) : existing.allow_modify;

    this.db
      .prepare(
        `UPDATE accounts
         SET label = ?, password_enc = ?, recovery_enc = ?, totp_enc = ?, notes_enc = ?,
             allow_modify = ?, pw_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        nextLabel,
        nextPasswordEnc,
        nextRecoveryEnc,
        nextTotpEnc,
        nextNotesEnc,
        nextAllowModify,
        nextPwUpdatedAt,
        nowIso,
        existing.id,
      );

    const tokenRow = this.db
      .prepare('SELECT needs_reauth FROM tokens WHERE email = ?')
      .get(email) as { needs_reauth: number } | undefined;

    return {
      id: existing.id,
      email,
      label: nextLabel,
      hasPassword: nextPasswordEnc !== null && nextPasswordEnc.length > 0,
      hasRecovery: nextRecoveryEnc !== null && nextRecoveryEnc.length > 0,
      hasTotp: nextTotpEnc !== null && nextTotpEnc.length > 0,
      hasNotes: nextNotesEnc !== null && nextNotesEnc.length > 0,
      allowModify: nextAllowModify === 1,
      pwUpdatedAt: nextPwUpdatedAt,
      authorized: Boolean(tokenRow) && tokenRow!.needs_reauth !== 1,
      needsReauth: Boolean(tokenRow) && tokenRow!.needs_reauth === 1,
      createdAt: existing.created_at,
    };
  }

  markPasswordChanged(email: string): number {
    this.requireDek();
    const clean = email.trim().toLowerCase();
    const nowSec = Math.floor(Date.now() / 1000);
    const info = this.db
      .prepare('UPDATE accounts SET pw_updated_at = ?, updated_at = ? WHERE email = ?')
      .run(nowSec, new Date().toISOString(), clean);
    if (info.changes === 0) {
      throw new Error(`Không tìm thấy tài khoản: ${clean}`);
    }
    return nowSec;
  }

  deleteAccount(email: string): boolean {
    this.requireDek();
    const clean = email.trim().toLowerCase();
    return this.db.transaction(() => {
      const info = this.db.prepare('DELETE FROM accounts WHERE email = ?').run(clean);
      this.db.prepare('DELETE FROM tokens WHERE email = ?').run(clean);
      return info.changes > 0;
    })();
  }

  /**
   * Main-process ONLY: read a single decrypted secret field using strict column allowlist.
   */
  getAccountSecret(email: string, field: VaultSecretField): string {
    const dek = this.requireDek();
    const column = SECRET_COLUMN_ALLOWLIST[field];
    if (!column) {
      throw new Error(`Trường không hợp lệ: ${String(field)}`);
    }
    const clean = email.trim().toLowerCase();
    const row = this.db
      .prepare(`SELECT id, ${column} as val FROM accounts WHERE email = ?`)
      .get(clean) as { id: string; val: Buffer | null } | undefined;
    if (!row || !row.val) return '';
    return decryptField(dek, row.val, makeFieldAad('accounts', row.id, field));
  }

  // ---- OAuth Tokens & Google credentials.json (encrypted in vault) ----

  getOAuthToken(email: string): { tokenJson: string; scope: string; needsReauth: boolean } | null {
    const dek = this.requireDek();
    const clean = email.trim().toLowerCase();
    const row = this.db
      .prepare('SELECT token_enc, scope, needs_reauth FROM tokens WHERE email = ?')
      .get(clean) as { token_enc: Buffer; scope: string; needs_reauth: number } | undefined;
    if (!row) return null;
    const tokenJson = decryptField(dek, row.token_enc, makeFieldAad('tokens', clean, 'token'));
    return {
      tokenJson,
      scope: row.scope,
      needsReauth: row.needs_reauth === 1,
    };
  }

  setOAuthToken(email: string, tokenJson: string, scope = ''): void {
    const dek = this.requireDek();
    const clean = email.trim().toLowerCase();
    const enc = encryptField(dek, tokenJson, makeFieldAad('tokens', clean, 'token'))!;
    this.db
      .prepare(
        `INSERT INTO tokens (email, token_enc, needs_reauth, scope, updated_at)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           token_enc = excluded.token_enc,
           needs_reauth = 0,
           scope = excluded.scope,
           updated_at = excluded.updated_at`,
      )
      .run(clean, enc, scope, new Date().toISOString());
  }

  markTokenNeedsReauth(email: string): void {
    this.requireDek();
    const clean = email.trim().toLowerCase();
    this.db
      .prepare('UPDATE tokens SET needs_reauth = 1, updated_at = ? WHERE email = ?')
      .run(new Date().toISOString(), clean);
  }

  deleteOAuthToken(email: string): boolean {
    this.requireDek();
    const clean = email.trim().toLowerCase();
    const info = this.db.prepare('DELETE FROM tokens WHERE email = ?').run(clean);
    return info.changes > 0;
  }

  setGoogleCredentials(credentialsJson: string): void {
    const dek = this.requireDek();
    // Basic validation that it's a Desktop/Installed OAuth client JSON
    const parsed = JSON.parse(credentialsJson) as {
      installed?: { client_id?: string; client_secret?: string };
      web?: { client_id?: string };
    };
    if (!parsed.installed?.client_id && !parsed.web?.client_id) {
      throw new Error('File credentials.json không hợp lệ (thiếu client_id OAuth Desktop app)');
    }
    const enc = encryptField(
      dek,
      credentialsJson,
      makeFieldAad('secrets', 'google_credentials', 'v'),
    )!;
    this.db
      .prepare(
        `INSERT INTO secrets (k, v_enc, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(k) DO UPDATE SET v_enc = excluded.v_enc, updated_at = excluded.updated_at`,
      )
      .run('google_credentials', enc, new Date().toISOString());
  }

  getGoogleCredentials(): string | null {
    const dek = this.requireDek();
    const row = this.db
      .prepare('SELECT v_enc FROM secrets WHERE k = ?')
      .get('google_credentials') as { v_enc: Buffer } | undefined;
    if (!row) return null;
    return decryptField(dek, row.v_enc, makeFieldAad('secrets', 'google_credentials', 'v'));
  }
}
