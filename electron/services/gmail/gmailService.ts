import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as ArchiverTypes from 'archiver';
import { google, type gmail_v1 } from 'googleapis';
import type {
  GmailBackupOptions,
  GmailBackupProgress,
  GmailMessageSummary,
} from '@shared/vaultTypes';
import type { VaultService } from '../vault/vaultService';
import { GMAIL_SCOPE_MODIFY, type GmailOAuthService } from './oauthService';

const require = createRequire(import.meta.url);

type ArchiverCallable = ((
  format: string,
  options?: ArchiverTypes.ArchiverOptions & { encryptionMethod?: string; password?: string },
) => ArchiverTypes.Archiver) & {
  registerFormat: (format: string, mod: unknown) => void;
};

let zipEncryptedRegistered = false;
function getArchiver(): ArchiverCallable {
  const rawMod = require('archiver') as ArchiverCallable | { default?: ArchiverCallable };
  const archiverMod =
    typeof rawMod === 'function'
      ? rawMod
      : typeof rawMod.default === 'function'
        ? rawMod.default
        : null;
  if (!archiverMod) {
    throw new Error('Không thể nạp thư viện archiver để nén ZIP mã hóa');
  }
  if (!zipEncryptedRegistered) {
    try {
      const rawZipEnc = require('archiver-zip-encrypted') as { default?: unknown } | unknown;
      const zipEncryptedMod =
        typeof rawZipEnc === 'object' && rawZipEnc !== null && 'default' in rawZipEnc
          ? ((rawZipEnc as { default?: unknown }).default ?? rawZipEnc)
          : rawZipEnc;
      archiverMod.registerFormat('zip-encrypted', zipEncryptedMod);
    } catch {
      // Already registered
    }
    zipEncryptedRegistered = true;
  }
  return archiverMod;
}

export interface GmailServiceOptions {
  /** Optional custom Gmail API root URL (for integration tests with local mock server). */
  apiRootUrl?: string;
  /** Base backoff delay in ms for HTTP 429 / 5xx retries (default: 500ms). */
  retryBaseDelayMs?: number;
  /** Max retry attempts on 429 / 5xx (default: 3). */
  maxRetries?: number;
  /** Concurrency limit across accounts/messages (default: 3). */
  concurrency?: number;
}

function getHttpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const candidates = [e.response?.status, e.status, e.code];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 100 && c <= 599) return c;
  }
  return null;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Thao tác đã bị hủy'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Thao tác đã bị hủy'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) {
        throw new Error('Thao tác đã bị hủy');
      }
      const idx = cursor++;
      results[idx] = await worker(items[idx]!, idx);
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 120) || 'account';
}

function extractHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  const found = headers.find((h) => h.name?.toLowerCase() === target);
  return found?.value ?? '';
}

function decodeBase64UrlToBuffer(data: string): Buffer {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export class GmailService {
  private vault: VaultService;
  private oauth: GmailOAuthService;
  private options: GmailServiceOptions;

  constructor(vault: VaultService, oauth: GmailOAuthService, options: GmailServiceOptions = {}) {
    this.vault = vault;
    this.oauth = oauth;
    this.options = options;
  }

  private async withRetry<T>(
    email: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const maxRetries = this.options.maxRetries ?? 3;
    const baseDelay = this.options.retryBaseDelayMs ?? 500;

    let attempt = 0;
    while (true) {
      if (signal?.aborted) {
        throw new Error('Thao tác đã bị hủy');
      }
      try {
        return await fn();
      } catch (err) {
        const status = getHttpStatus(err);
        if (status === 401) {
          this.oauth.clearCache();
          if (this.vault.isUnlocked()) {
            this.vault.markTokenNeedsReauth(email);
          }
          throw new Error('Token Gmail đã hết hạn hoặc bị thu hồi. Vui lòng cấp quyền lại.');
        }

        const retryable = status === 429 || (status !== null && status >= 500 && status < 600);
        if (!retryable || attempt >= maxRetries) {
          throw err;
        }
        attempt += 1;
        const delayMs = baseDelay * 2 ** (attempt - 1);
        await sleepWithAbort(delayMs, signal);
      }
    }
  }

  private async getGmailClient(email: string): Promise<{ gmail: gmail_v1.Gmail; scope: string }> {
    const { client, scope } = await this.oauth.getAuthorizedClient(email);
    const gmail = google.gmail({
      version: 'v1',
      auth: client,
      ...(this.options.apiRootUrl ? { rootUrl: this.options.apiRootUrl } : {}),
    });
    return { gmail, scope };
  }

  /**
   * Search messages across one or more authorized accounts.
   * Message metadata/snippets exist ONLY in memory — never logged or persisted to SQLite.
   */
  async searchMessages(
    emails: string[],
    query: string,
    maxPerAccount = 25,
    signal?: AbortSignal,
  ): Promise<GmailMessageSummary[]> {
    const clampedMax = Math.max(1, Math.min(100, Math.floor(maxPerAccount)));
    const concurrency = this.options.concurrency ?? 3;
    const cleanEmails = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

    const perAccountResults = await runWithConcurrency(
      cleanEmails,
      concurrency,
      async (email) => {
        const { gmail } = await this.getGmailClient(email);
        const listRes = await this.withRetry(
          email,
          () =>
            gmail.users.messages.list({
              userId: 'me',
              q: query || undefined,
              maxResults: clampedMax,
            }),
          signal,
        );

        const rawMsgs = listRes.data.messages ?? [];
        const ids = rawMsgs.map((m) => m.id).filter((id): id is string => Boolean(id));
        if (ids.length === 0) return [] as GmailMessageSummary[];

        const summaries = await runWithConcurrency(
          ids,
          concurrency,
          async (id) => {
            const detail = await this.withRetry(
              email,
              () =>
                gmail.users.messages.get({
                  userId: 'me',
                  id,
                  format: 'metadata',
                  metadataHeaders: ['From', 'Subject', 'Date'],
                }),
              signal,
            );

            const headers = detail.data.payload?.headers;
            const labelIds = detail.data.labelIds ?? [];
            return {
              accountEmail: email,
              id,
              threadId: detail.data.threadId ?? '',
              from: extractHeader(headers, 'From'),
              subject: extractHeader(headers, 'Subject') || '(Không có tiêu đề)',
              date: extractHeader(headers, 'Date'),
              snippet: detail.data.snippet ?? '',
              labelIds,
              unread: labelIds.includes('UNREAD'),
              starred: labelIds.includes('STARRED'),
            } satisfies GmailMessageSummary;
          },
          signal,
        );

        return summaries;
      },
      signal,
    );

    return perAccountResults.flat();
  }

  /**
   * Batch modify labels (mark read/unread, star/unstar, archive, trash).
   * Requires opt-in gmail.modify scope.
   */
  async batchModifyMessages(
    email: string,
    ids: string[],
    addLabelIds: string[],
    removeLabelIds: string[],
    signal?: AbortSignal,
  ): Promise<{ modifiedCount: number }> {
    if (ids.length === 0) return { modifiedCount: 0 };
    const cleanEmail = email.trim().toLowerCase();
    const { gmail, scope } = await this.getGmailClient(cleanEmail);

    if (!scope.includes(GMAIL_SCOPE_MODIFY)) {
      throw new Error(
        'Tài khoản này chỉ có quyền đọc (gmail.readonly). Hãy bật tùy chọn "Cho phép chỉnh sửa hộp thư" và cấp quyền lại để gắn nhãn/lưu trữ/xóa thư.',
      );
    }

    await this.withRetry(
      cleanEmail,
      () =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids,
            addLabelIds: addLabelIds.length > 0 ? addLabelIds : undefined,
            removeLabelIds: removeLabelIds.length > 0 ? removeLabelIds : undefined,
          },
        }),
      signal,
    );

    return { modifiedCount: ids.length };
  }

  /**
   * Backup messages as .eml files.
   * Defaults to AES-256 encrypted .zip (never writes plaintext .eml to disk).
   */
  async backupEmails(
    options: GmailBackupOptions,
    onProgress?: (progress: GmailBackupProgress) => void,
    signal?: AbortSignal,
  ): Promise<GmailBackupProgress> {
    const cleanEmail = options.email.trim().toLowerCase();
    const maxMessages = Math.max(1, Math.min(5000, Math.floor(options.maxMessages)));

    if (!options.targetDir || !path.isAbsolute(options.targetDir)) {
      throw new Error('Thư mục lưu sao lưu không hợp lệ');
    }
    if (options.encryptZip && (!options.zipPassword || options.zipPassword.length < 4)) {
      throw new Error('Vui lòng nhập mật khẩu nén ZIP (tối thiểu 4 ký tự)');
    }

    const { gmail } = await this.getGmailClient(cleanEmail);

    // 1. Collect up to maxMessages IDs via pagination
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < maxMessages) {
      if (signal?.aborted) {
        const cancelled: GmailBackupProgress = {
          email: cleanEmail,
          current: 0,
          total: ids.length,
          done: true,
          cancelled: true,
        };
        onProgress?.(cancelled);
        return cancelled;
      }

      const remaining = maxMessages - ids.length;
      const listRes = await this.withRetry(
        cleanEmail,
        () =>
          gmail.users.messages.list({
            userId: 'me',
            maxResults: Math.min(500, remaining),
            pageToken,
          }),
        signal,
      );

      for (const m of listRes.data.messages ?? []) {
        if (m.id && ids.length < maxMessages) {
          ids.push(m.id);
        }
      }
      pageToken = listRes.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }

    const total = ids.length;
    onProgress?.({ email: cleanEmail, current: 0, total });

    fs.mkdirSync(options.targetDir, { recursive: true });
    const safeEmail = sanitizeSegment(cleanEmail);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (options.encryptZip) {
      const archiver = getArchiver();
      const zipPath = path.join(options.targetDir, `gmail-backup-${safeEmail}-${timestamp}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip-encrypted', {
        zlib: { level: 6 },
        encryptionMethod: 'aes256',
        password: options.zipPassword,
      });

      const finishPromise = new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
      });

      archive.pipe(output);

      let current = 0;
      try {
        for (const id of ids) {
          if (signal?.aborted) {
            archive.abort();
            output.destroy();
            try {
              if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            } catch {
              // Ignore cleanup errors
            }
            const cancelled: GmailBackupProgress = {
              email: cleanEmail,
              current,
              total,
              done: true,
              cancelled: true,
            };
            onProgress?.(cancelled);
            return cancelled;
          }

          const rawRes = await this.withRetry(
            cleanEmail,
            () =>
              gmail.users.messages.get({
                userId: 'me',
                id,
                format: 'raw',
              }),
            signal,
          );
          const rawData = rawRes.data.raw;
          if (rawData) {
            const emlBuf = decodeBase64UrlToBuffer(rawData);
            archive.append(emlBuf, { name: `${sanitizeSegment(id)}.eml` });
          }
          current += 1;
          onProgress?.({ email: cleanEmail, current, total });
        }

        await archive.finalize();
        await finishPromise;

        const done: GmailBackupProgress = {
          email: cleanEmail,
          current,
          total,
          done: true,
          outputPath: zipPath,
        };
        onProgress?.(done);
        return done;
      } catch (err) {
        archive.abort();
        output.destroy();
        try {
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        } catch {
          // Ignore cleanup errors
        }
        throw err;
      }
    } else {
      // Unencrypted .eml folder (user explicitly opted out of encrypted zip after warning)
      const outDir = path.join(options.targetDir, `gmail-backup-${safeEmail}-${timestamp}`);
      fs.mkdirSync(outDir, { recursive: true });

      let current = 0;
      for (const id of ids) {
        if (signal?.aborted) {
          const cancelled: GmailBackupProgress = {
            email: cleanEmail,
            current,
            total,
            done: true,
            cancelled: true,
            outputPath: outDir,
          };
          onProgress?.(cancelled);
          return cancelled;
        }
        const rawRes = await this.withRetry(
          cleanEmail,
          () =>
            gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'raw',
            }),
          signal,
        );
        const rawData = rawRes.data.raw;
        if (rawData) {
          const emlBuf = decodeBase64UrlToBuffer(rawData);
          fs.writeFileSync(path.join(outDir, `${sanitizeSegment(id)}.eml`), emlBuf);
        }
        current += 1;
        onProgress?.({ email: cleanEmail, current, total });
      }

      const done: GmailBackupProgress = {
        email: cleanEmail,
        current,
        total,
        done: true,
        outputPath: outDir,
      };
      onProgress?.(done);
      return done;
    }
  }
}
