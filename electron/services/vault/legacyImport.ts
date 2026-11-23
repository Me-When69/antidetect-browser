import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import * as fernet from 'fernet';
import type { LegacyImportResult } from '@shared/vaultTypes';
import { VaultService, WrongPasswordError } from './vaultService';

export interface LegacyImportOptions {
  legacyDbPath: string;
  legacyMasterPassword: string;
  overwriteDuplicates: boolean;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function decryptFernetValue(secret: fernet.Secret, raw: Buffer | string | null): string {
  if (!raw) return '';
  const tokenStr = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  if (!tokenStr) return '';
  const tok = new fernet.Token({ secret, token: tokenStr, ttl: 0 });
  return tok.decode();
}

export function importFromLegacyPythonVault(
  targetVault: VaultService,
  options: LegacyImportOptions,
): LegacyImportResult {
  if (!targetVault.isUnlocked()) {
    throw new Error('Vui lòng mở khóa vault mới trước khi nhập dữ liệu');
  }
  if (!fs.existsSync(options.legacyDbPath)) {
    throw new Error(`Không tìm thấy file vault cũ: ${options.legacyDbPath}`);
  }

  const legacyDb = new Database(options.legacyDbPath, { readonly: true, fileMustExist: true });
  try {
    const saltRow = legacyDb.prepare("SELECT v FROM meta WHERE k = 'salt'").get() as
      { v: Buffer | string } | undefined;
    const checkRow = legacyDb.prepare("SELECT v FROM meta WHERE k = 'check'").get() as
      { v: Buffer | string } | undefined;

    if (!saltRow || !checkRow) {
      throw new Error('File không đúng định dạng vault.db của Gmail Manager cũ');
    }

    const saltBuf = Buffer.isBuffer(saltRow.v) ? saltRow.v : Buffer.from(saltRow.v, 'utf8');
    const keyBuf = crypto.scryptSync(
      Buffer.from(options.legacyMasterPassword, 'utf8'),
      saltBuf,
      32,
      {
        N: 16384, // 2^14 as in Python vault.py
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      },
    );
    const secret = new fernet.Secret(toBase64Url(keyBuf));
    keyBuf.fill(0);

    // Verify legacy master password against canary 'check'
    try {
      const checkVal = decryptFernetValue(secret, checkRow.v);
      if (checkVal !== 'ok') {
        throw new WrongPasswordError('Sai mật khẩu chính của vault cũ');
      }
    } catch {
      throw new WrongPasswordError('Sai mật khẩu chính của vault cũ');
    }

    const existingEmails = new Set(targetVault.listAccounts().map((a) => a.email.toLowerCase()));
    const legacyAccounts = legacyDb
      .prepare(
        'SELECT id, email, label, notes, password, recovery, totp, pw_updated FROM accounts ORDER BY email ASC',
      )
      .all() as {
      id: number;
      email: string;
      label: string | null;
      notes: string | null;
      password: Buffer | string | null;
      recovery: string | null;
      totp: Buffer | string | null;
      pw_updated: number | null;
    }[];

    const result: LegacyImportResult = {
      imported: 0,
      overwritten: 0,
      skipped: 0,
      tokensImported: 0,
      errors: [],
    };
    const importedEmails = new Set<string>();

    for (const row of legacyAccounts) {
      const email = (row.email ?? '').trim().toLowerCase();
      if (!email) continue;
      try {
        const password = decryptFernetValue(secret, row.password);
        const totp = decryptFernetValue(secret, row.totp);
        const label = row.label ?? '';
        const recovery = row.recovery ?? '';
        const notes = row.notes ?? '';

        if (existingEmails.has(email)) {
          if (!options.overwriteDuplicates) {
            result.skipped += 1;
            continue;
          }
          targetVault.updateAccount({
            email,
            label,
            password,
            recovery,
            totp,
            notes,
          });
          result.overwritten += 1;
          importedEmails.add(email);
        } else {
          targetVault.addAccount({
            email,
            label,
            password,
            recovery,
            totp,
            notes,
          });
          existingEmails.add(email);
          result.imported += 1;
          importedEmails.add(email);
        }
      } catch (err) {
        result.errors.push(
          `Không nhập được ${email}: ${err instanceof Error ? err.message : 'Lỗi không xác định'}`,
        );
      }
    }

    // Import OAuth tokens if table exists
    const hasTokensTable = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'")
      .get();
    if (hasTokensTable) {
      const legacyTokens = legacyDb.prepare('SELECT email, token FROM tokens').all() as {
        email: string;
        token: Buffer | string | null;
      }[];
      for (const trow of legacyTokens) {
        const email = (trow.email ?? '').trim().toLowerCase();
        if (!email || !importedEmails.has(email) || !trow.token) continue;
        try {
          const tokenJson = decryptFernetValue(secret, trow.token);
          if (tokenJson) {
            targetVault.setOAuthToken(email, tokenJson, 'legacy-import');
            result.tokensImported += 1;
          }
        } catch {
          // Skip corrupt legacy token
        }
      }
    }

    return result;
  } finally {
    legacyDb.close();
  }
}
