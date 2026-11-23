import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CodeChallengeMethod, OAuth2Client, type Credentials } from 'google-auth-library';
import type { VaultService } from '../vault/vaultService';

export const GMAIL_SCOPE_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SCOPE_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

const ALLOWED_SCOPES = new Set<string>([GMAIL_SCOPE_READONLY, GMAIL_SCOPE_MODIFY]);

interface ParsedGoogleCredentials {
  clientId: string;
  clientSecret: string;
  authUri?: string;
  tokenUri?: string;
}

export interface OAuthServiceOptions {
  openExternal?: (url: string) => Promise<void>;
  timeoutMs?: number;
  /** Optional custom OAuth endpoints (used in integration tests with a local mock server). */
  tokenEndpointOverride?: string;
  authEndpointOverride?: string;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier, 'ascii').digest());
  return { verifier, challenge };
}

function parseGoogleCredentialsJson(raw: string): ParsedGoogleCredentials {
  const parsed = JSON.parse(raw) as {
    installed?: {
      client_id?: string;
      client_secret?: string;
      auth_uri?: string;
      token_uri?: string;
    };
    web?: {
      client_id?: string;
      client_secret?: string;
      auth_uri?: string;
      token_uri?: string;
    };
  };
  const cfg = parsed.installed ?? parsed.web;
  if (!cfg?.client_id) {
    throw new Error('File credentials.json không hợp lệ (thiếu client_id)');
  }
  return {
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret ?? '',
    authUri: cfg.auth_uri,
    tokenUri: cfg.token_uri,
  };
}

export function resolveAllowedScope(allowModify: boolean): string {
  const scope = allowModify ? GMAIL_SCOPE_MODIFY : GMAIL_SCOPE_READONLY;
  if (!ALLOWED_SCOPES.has(scope)) {
    throw new Error('Phạm vi quyền Gmail không được phép');
  }
  return scope;
}

function isTokenRevokedOrExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const responseData =
    typeof err === 'object' && err !== null && 'response' in err
      ? JSON.stringify((err as { response?: { data?: unknown } }).response?.data ?? '').toLowerCase()
      : '';
  const combined = `${msg} ${responseData}`;
  return (
    combined.includes('invalid_grant') ||
    combined.includes('token has been expired') ||
    combined.includes('token has been revoked') ||
    combined.includes('unauthorized') ||
    combined.includes('invalid_token')
  );
}

const TOKEN_EXPIRED_VI_MSG =
  'Token Gmail đã hết hạn hoặc bị thu hồi. Vui lòng cấp quyền lại.';

export class GmailOAuthService {
  private vault: VaultService;
  private options: OAuthServiceOptions;
  private clientCache = new Map<string, OAuth2Client>();
  private unsubscribeLock: () => void;

  constructor(vault: VaultService, options: OAuthServiceOptions = {}) {
    this.vault = vault;
    this.options = options;
    this.unsubscribeLock = this.vault.onLock(() => {
      this.clearCache();
    });
  }

  dispose(): void {
    this.unsubscribeLock();
    this.clearCache();
  }

  clearCache(): void {
    this.clientCache.clear();
  }

  private getCredentials(): ParsedGoogleCredentials {
    const raw = this.vault.getGoogleCredentials();
    if (!raw) {
      throw new Error(
        'Chưa nhập file Google OAuth credentials.json. Vui lòng xem docs/GMAIL_SETUP.md và nhập file trong Cài đặt kho.',
      );
    }
    return parseGoogleCredentialsJson(raw);
  }

  private createOAuthClient(creds: ParsedGoogleCredentials, redirectUri?: string): OAuth2Client {
    const client = new OAuth2Client({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri,
      endpoints: {
        oauth2AuthBaseUrl: this.options.authEndpointOverride ?? creds.authUri,
        oauth2TokenUrl: this.options.tokenEndpointOverride ?? creds.tokenUri,
      },
    });
    return client;
  }

  /**
   * Run Desktop Loopback OAuth2 + PKCE + state check via the system browser.
   * NEVER uses Playwright and NEVER automates Google login.
   */
  async authorizeAccount(
    email: string,
    allowModify: boolean,
    signal?: AbortSignal,
  ): Promise<{ scope: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const creds = this.getCredentials();
    const scope = resolveAllowedScope(allowModify);
    const { verifier, challenge } = generatePkcePair();
    const expectedState = base64UrlEncode(crypto.randomBytes(24));

    const openExternal = this.options.openExternal;
    if (!openExternal) {
      throw new Error('Không có hàm mở trình duyệt hệ thống (openExternal)');
    }

    const timeoutMs = this.options.timeoutMs ?? 180_000;

    return await new Promise<{ scope: string }>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let server: http.Server | null = null;

      const finish = (err: Error | null, result?: { scope: string }) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (server) {
          try {
            server.close();
          } catch {
            // Ignore close errors
          }
          server = null;
        }
        if (err) {
          reject(err);
        } else {
          resolve(result!);
        }
      };

      const onAbort = () => {
        finish(new Error('Đã hủy quá trình cấp quyền Gmail'));
      };

      if (signal?.aborted) {
        finish(new Error('Đã hủy quá trình cấp quyền Gmail'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      server = http.createServer((req, res) => {
        void (async () => {
          try {
            const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (reqUrl.pathname !== '/oauth2callback') {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Not found');
              return;
            }

            const errorParam = reqUrl.searchParams.get('error');
            const returnedState = reqUrl.searchParams.get('state');
            const code = reqUrl.searchParams.get('code');

            if (errorParam) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(
                '<html><body style="font-family:sans-serif;padding:24px"><h3>Cấp quyền bị từ chối</h3><p>Bạn có thể đóng tab này và quay lại Facet.</p></body></html>',
              );
              finish(new Error(`Google OAuth bị từ chối: ${errorParam}`));
              return;
            }

            if (!returnedState || returnedState !== expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(
                '<html><body style="font-family:sans-serif;padding:24px"><h3>Lỗi xác thực state OAuth</h3><p>Vui lòng thử lại từ Facet.</p></body></html>',
              );
              finish(new Error('OAuth state không khớp (nghi ngờ CSRF)'));
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Missing authorization code');
              finish(new Error('Thiếu mã xác thực (authorization code) từ Google'));
              return;
            }

            const addr = server?.address() as AddressInfo | null;
            const redirectUri = `http://127.0.0.1:${addr?.port ?? 0}/oauth2callback`;
            const oauthClient = this.createOAuthClient(creds, redirectUri);

            const { tokens } = await oauthClient.getToken({
              code,
              codeVerifier: verifier,
              redirect_uri: redirectUri,
            });

            const grantedScope = tokens.scope ?? scope;
            if (grantedScope.includes('gmail.send')) {
              res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Scope gmail.send is not allowed');
              finish(new Error('Phạm vi quyền gmail.send không được phép trong Facet'));
              return;
            }

            oauthClient.setCredentials(tokens);
            this.vault.setOAuthToken(cleanEmail, JSON.stringify(tokens), grantedScope);
            this.clientCache.set(cleanEmail, oauthClient);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              '<html><body style="font-family:sans-serif;padding:24px"><h3>Cấp quyền Gmail thành công!</h3><p>Bạn có thể đóng tab này và quay lại ứng dụng Facet.</p></body></html>',
            );
            finish(null, { scope: grantedScope });
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              '<html><body style="font-family:sans-serif;padding:24px"><h3>Lỗi đổi token OAuth</h3><p>Vui lòng quay lại Facet để xem chi tiết.</p></body></html>',
            );
            finish(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });

      server.on('error', (err) => {
        finish(new Error(`Không thể khởi động máy chủ OAuth cục bộ: ${err.message}`));
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server?.address() as AddressInfo | null;
        if (!addr) {
          finish(new Error('Không xác định được cổng loopback OAuth'));
          return;
        }
        const redirectUri = `http://127.0.0.1:${addr.port}/oauth2callback`;
        const oauthClient = this.createOAuthClient(creds, redirectUri);

        const authUrl = oauthClient.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: [scope],
          state: expectedState,
          login_hint: cleanEmail,
          code_challenge: challenge,
          code_challenge_method: CodeChallengeMethod.S256,
        });

        timer = setTimeout(() => {
          finish(new Error('Hết thời gian chờ cấp quyền OAuth (3 phút). Vui lòng thử lại.'));
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }

        void openExternal(authUrl).catch((err) => {
          finish(
            new Error(
              `Không thể mở trình duyệt hệ thống: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });
      });
    });
  }

  /**
   * Retrieve an authenticated OAuth2Client for the given email.
   * Automatically refreshes expired access tokens and saves updated tokens back to vault.
   */
  async getAuthorizedClient(email: string): Promise<{ client: OAuth2Client; scope: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const tokenRecord = this.vault.getOAuthToken(cleanEmail);
    if (!tokenRecord) {
      throw new Error(`Tài khoản ${cleanEmail} chưa được cấp quyền Gmail API.`);
    }
    if (tokenRecord.needsReauth) {
      throw new Error(TOKEN_EXPIRED_VI_MSG);
    }

    let client = this.clientCache.get(cleanEmail);
    if (!client) {
      const creds = this.getCredentials();
      client = this.createOAuthClient(creds);
      const parsedTokens = JSON.parse(tokenRecord.tokenJson) as Credentials;
      client.setCredentials(parsedTokens);

      // Persist refreshed tokens whenever google-auth-library rotates them
      client.on('tokens', (newTokens) => {
        try {
          if (!this.vault.isUnlocked()) return;
          const current = client?.credentials ?? {};
          const merged: Credentials = {
            ...current,
            ...newTokens,
            refresh_token: newTokens.refresh_token ?? current.refresh_token,
          };
          this.vault.setOAuthToken(cleanEmail, JSON.stringify(merged), tokenRecord.scope);
        } catch {
          // Ignore persistence errors if vault locked mid-request
        }
      });

      this.clientCache.set(cleanEmail, client);
    }

    // Proactively verify/refresh access token if missing or near expiry
    const expiryDate = client.credentials.expiry_date;
    const isExpired =
      !client.credentials.access_token ||
      (typeof expiryDate === 'number' && expiryDate <= Date.now() + 60_000);

    if (isExpired) {
      try {
        const res = await client.getAccessToken();
        if (!res.token) {
          throw new Error('invalid_grant');
        }
        // Save updated credentials (expiry_date / access_token)
        if (this.vault.isUnlocked()) {
          this.vault.setOAuthToken(cleanEmail, JSON.stringify(client.credentials), tokenRecord.scope);
        }
      } catch (err) {
        this.clientCache.delete(cleanEmail);
        if (isTokenRevokedOrExpiredError(err)) {
          if (this.vault.isUnlocked()) {
            this.vault.markTokenNeedsReauth(cleanEmail);
          }
          throw new Error(TOKEN_EXPIRED_VI_MSG);
        }
        throw err;
      }
    }

    return { client, scope: tokenRecord.scope };
  }
}
