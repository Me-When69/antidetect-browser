import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { VaultService } from '../../electron/services/vault/vaultService';
import {
  GMAIL_SCOPE_MODIFY,
  GMAIL_SCOPE_READONLY,
  GmailOAuthService,
} from '../../electron/services/gmail/oauthService';
import { GmailService } from '../../electron/services/gmail/gmailService';
import {
  extractEncryptedEmlArchive,
  isLegacyZipArchive,
} from '../../electron/services/gmail/emlArchive';
import { ProfileService } from '../../electron/services/profileService';
import { SecretService } from '../../electron/services/secretService';
import { SettingsService } from '../../electron/services/settingsService';
import { ProxyService } from '../../electron/services/proxyService';
import { AppLogger } from '../../electron/services/logger';
import { ProfileLauncher } from '../../electron/services/launcher';
import type { BrowserDriver, DriverInstance } from '../../electron/services/drivers/BrowserDriver';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';

interface MockServerState {
  failRefreshWithInvalidGrant: boolean;
  rateLimitListOnce: boolean;
  lastBatchModifyBody: unknown;
}

describe('Gmail Module Integration Tests (Mocked OAuth + Mocked Gmail API, zero external calls)', () => {
  let mockServer: http.Server;
  let mockBaseUrl = '';
  const state: MockServerState = {
    failRefreshWithInvalidGrant: false,
    rateLimitListOnce: false,
    lastBatchModifyBody: null,
  };
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const rawEml = Buffer.from(
      'From: sender@example.com\r\nTo: test@example.com\r\nSubject: Hello Facet\r\n\r\nTest body content.',
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    mockServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');

        // 1. Mock OAuth2 Token Endpoint
        if (url.pathname === '/oauth2/token' && req.method === 'POST') {
          const params = new URLSearchParams(bodyStr);
          const grantType = params.get('grant_type');
          if (grantType === 'refresh_token' && state.failRefreshWithInvalidGrant) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Token has been revoked',
              }),
            );
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'mock-access-token-123',
              refresh_token: 'mock-refresh-token-456',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: GMAIL_SCOPE_MODIFY,
            }),
          );
          return;
        }

        // 1b. Mock OAuth2 Revoke Endpoint
        if (url.pathname === '/oauth2/revoke' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
          return;
        }

        // 2. Mock Gmail API: users/me/messages (list)
        if (url.pathname === '/gmail/v1/users/me/messages' && req.method === 'GET') {
          if (state.rateLimitListOnce) {
            state.rateLimitListOnce = false;
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 429, message: 'Rate Limit Exceeded' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              messages: [{ id: 'msg-1', threadId: 'thr-1' }],
            }),
          );
          return;
        }

        // 3. Mock Gmail API: users/me/messages/batchModify
        if (url.pathname === '/gmail/v1/users/me/messages/batchModify' && req.method === 'POST') {
          state.lastBatchModifyBody = JSON.parse(bodyStr);
          res.writeHead(204);
          res.end();
          return;
        }

        // 4. Mock Gmail API: users/me/messages/:id
        if (url.pathname === '/gmail/v1/users/me/messages/msg-1' && req.method === 'GET') {
          const format = url.searchParams.get('format');
          if (format === 'raw') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'msg-1', threadId: 'thr-1', raw: rawEml }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'msg-1',
              threadId: 'thr-1',
              snippet: 'Test body content.',
              labelIds: ['INBOX', 'UNREAD'],
              payload: {
                headers: [
                  { name: 'From', value: 'sender@example.com' },
                  { name: 'Subject', value: 'Hello Facet' },
                  { name: 'Date', value: 'Mon, 23 Nov 2026 05:00:00 +0000' },
                ],
              },
            }),
          );
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as AddressInfo;
        mockBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  afterEach(() => {
    state.failRefreshWithInvalidGrant = false;
    state.rateLimitListOnce = false;
    state.lastBatchModifyBody = null;
    while (tempDirs.length > 0) {
      try {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
      } catch {
        // Ignore Windows transient handle locks during test cleanup
      }
    }
  });

  function setupVault(): { dir: string; vault: VaultService } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-gmail-int-'));
    tempDirs.push(dir);
    const vault = new VaultService(path.join(dir, 'vault.db'));
    vault.unlock('IntegrationMaster!1');
    vault.setGoogleCredentials(
      JSON.stringify({
        installed: {
          client_id: 'mock-client-id',
          client_secret: 'mock-client-secret',
          auth_uri: `${mockBaseUrl}/oauth2/auth`,
          token_uri: `${mockBaseUrl}/oauth2/token`,
        },
      }),
    );
    vault.addAccount({
      email: 'alice@example.com',
      password: 'StrongPassword!1234',
      allowModify: true,
    });
    return { dir, vault };
  }

  it('completes OAuth2 PKCE loopback flow, enforces scopes (never gmail.send), and rejects bad state', async () => {
    const { vault } = setupVault();
    let capturedAuthUrl = '';

    const oauth = new GmailOAuthService(vault, {
      authEndpointOverride: `${mockBaseUrl}/oauth2/auth`,
      tokenEndpointOverride: `${mockBaseUrl}/oauth2/token`,
      openExternal: async (url) => {
        capturedAuthUrl = url;
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get('redirect_uri')!;
        const stateParam = parsed.searchParams.get('state')!;
        // Simulate browser redirect back to loopback callback
        await fetch(`${redirectUri}?code=mock-auth-code&state=${encodeURIComponent(stateParam)}`);
      },
    });

    const res = await oauth.authorizeAccount('alice@example.com', false);
    expect(capturedAuthUrl).toContain('code_challenge_method=S256');
    expect(capturedAuthUrl).toContain(encodeURIComponent(GMAIL_SCOPE_READONLY));
    expect(capturedAuthUrl).not.toContain('gmail.send');
    expect(res.scope).not.toContain('gmail.send');
    expect(vault.getOAuthToken('alice@example.com')).not.toBeNull();

    // Test CSRF state mismatch rejection
    const badOauth = new GmailOAuthService(vault, {
      authEndpointOverride: `${mockBaseUrl}/oauth2/auth`,
      tokenEndpointOverride: `${mockBaseUrl}/oauth2/token`,
      openExternal: async (url) => {
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get('redirect_uri')!;
        await fetch(`${redirectUri}?code=mock-auth-code&state=WRONG_STATE`);
      },
    });
    await expect(badOauth.authorizeAccount('alice@example.com', false)).rejects.toThrow(
      /state không khớp/i,
    );

    oauth.dispose();
    badOauth.dispose();
    vault.close();
  });

  it('revokes Gmail OAuth token remotely and still deletes locally when offline/unreachable (PHA 1.3)', async () => {
    const { vault } = setupVault();
    vault.setOAuthToken(
      'alice@example.com',
      JSON.stringify({ access_token: 'acc-1', refresh_token: 'ref-1' }),
      GMAIL_SCOPE_READONLY,
    );

    // Case 1: Remote revoke succeeds (HTTP 200)
    const oauthOk = new GmailOAuthService(vault, {
      revokeEndpointOverride: `${mockBaseUrl}/oauth2/revoke`,
    });
    const rev1 = await oauthOk.revokeAccount('alice@example.com');
    expect(rev1.remoteRevoked).toBe(true);
    expect(rev1.localDeleted).toBe(true);
    expect(vault.getOAuthToken('alice@example.com')).toBeNull();
    oauthOk.dispose();

    // Case 2: Remote revoke unreachable/offline -> still deletes local token cleanly
    vault.setOAuthToken(
      'alice@example.com',
      JSON.stringify({ access_token: 'acc-2', refresh_token: 'ref-2' }),
      GMAIL_SCOPE_READONLY,
    );
    const oauthOffline = new GmailOAuthService(vault, {
      revokeEndpointOverride: 'http://127.0.0.1:1/oauth2/revoke',
    });
    const rev2 = await oauthOffline.revokeAccount('alice@example.com');
    expect(rev2.remoteRevoked).toBe(false);
    expect(rev2.localDeleted).toBe(true);
    expect(rev2.notice).toContain('Đã xóa token cục bộ');
    expect(vault.getOAuthToken('alice@example.com')).toBeNull();
    oauthOffline.dispose();

    vault.close();
  });

  it('searches with 429 exponential backoff, batch modifies with modify scope, backs up to encrypted zip & plaintext eml, and marks needsReauth on invalid_grant', async () => {
    const { dir, vault } = setupVault();
    vault.setOAuthToken(
      'alice@example.com',
      JSON.stringify({
        access_token: 'mock-access-token-123',
        refresh_token: 'mock-refresh-token-456',
        expiry_date: Date.now() + 3_600_000,
      }),
      GMAIL_SCOPE_MODIFY,
    );

    const oauth = new GmailOAuthService(vault, {
      tokenEndpointOverride: `${mockBaseUrl}/oauth2/token`,
    });
    const gmail = new GmailService(vault, oauth, {
      apiRootUrl: mockBaseUrl,
      retryBaseDelayMs: 10,
      maxRetries: 2,
    });

    // 1. Search with simulated HTTP 429 on first attempt -> retries & succeeds
    state.rateLimitListOnce = true;
    const msgs = await gmail.searchMessages(['alice@example.com'], 'in:inbox', 10);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.subject).toBe('Hello Facet');
    expect(msgs[0]?.unread).toBe(true);

    // 2. Batch modify succeeds with gmail.modify
    const modRes = await gmail.batchModifyMessages('alice@example.com', ['msg-1'], [], ['UNREAD']);
    expect(modRes.modifiedCount).toBe(1);
    expect(state.lastBatchModifyBody).toEqual({ ids: ['msg-1'], removeLabelIds: ['UNREAD'] });

    // 3. Encrypted .facet-eml backup (default, AES-256-GCM) — leaves NO plaintext .eml on disk
    const zipTargetDir = path.join(dir, 'backup-zip');
    const zipProgress = await gmail.backupEmails({
      email: 'alice@example.com',
      maxMessages: 10,
      targetDir: zipTargetDir,
      encryptZip: true,
      zipPassword: 'ZipPassword!1',
    });
    expect(zipProgress.done).toBe(true);
    expect(zipProgress.outputPath?.endsWith('.facet-eml')).toBe(true);
    expect(fs.existsSync(zipProgress.outputPath!)).toBe(true);
    const filesInZipDir = fs.readdirSync(zipTargetDir);
    expect(filesInZipDir.some((f) => f.endsWith('.eml'))).toBe(false);

    // Verify round-trip extraction, wrong password rejection, and legacy PKZIP detection
    const rawArchive = fs.readFileSync(zipProgress.outputPath!);
    const extracted = extractEncryptedEmlArchive(rawArchive, 'ZipPassword!1');
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.content.toString('utf8')).toContain('Subject: Hello Facet');
    expect(() => extractEncryptedEmlArchive(rawArchive, 'WrongPass!')).toThrow(/Sai mật khẩu/);
    const legacyZipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(isLegacyZipArchive(legacyZipHeader)).toBe(true);
    expect(() => extractEncryptedEmlArchive(legacyZipHeader, 'any')).toThrow(/\.zip AES-256/);

    // 4. Unencrypted .eml backup
    const emlTargetDir = path.join(dir, 'backup-eml');
    const emlProgress = await gmail.backupEmails({
      email: 'alice@example.com',
      maxMessages: 10,
      targetDir: emlTargetDir,
      encryptZip: false,
    });
    expect(emlProgress.done).toBe(true);
    const emlFile = path.join(emlProgress.outputPath!, 'msg-1.eml');
    expect(fs.existsSync(emlFile)).toBe(true);
    expect(fs.readFileSync(emlFile, 'utf8')).toContain('Subject: Hello Facet');

    // 5. Token revoked / invalid_grant on refresh -> marks needsReauth
    oauth.clearCache();
    vault.setOAuthToken(
      'alice@example.com',
      JSON.stringify({
        access_token: 'expired',
        refresh_token: 'revoked',
        expiry_date: Date.now() - 10_000,
      }),
      GMAIL_SCOPE_MODIFY,
    );
    state.failRefreshWithInvalidGrant = true;
    await expect(gmail.searchMessages(['alice@example.com'], 'in:inbox')).rejects.toThrow(
      /hết hạn hoặc bị thu hồi/i,
    );
    const accAfter = vault.listAccounts().find((a) => a.email === 'alice@example.com');
    expect(accAfter?.needsReauth).toBe(true);

    oauth.dispose();
    vault.close();
  });

  it('links accounts to profiles, keeps vault accounts on profile delete, excludes vault from profile backup, and opens Gmail URL in profile without auto-filling', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-profile-link-'));
    tempDirs.push(dir);
    const dbCtx = createDatabase(path.join(dir, 'antidetect.db'));
    const vault = new VaultService(path.join(dir, 'vault.db'));
    vault.unlock('LinkMaster!1');
    vault.addAccount({ email: 'linked@example.com', password: 'TopSecretVaultPassword!9' });

    const secrets = new SecretService();
    const profileService = new ProfileService(dbCtx.db, secrets, path.join(dir, 'profiles'));
    const proxyService = new ProxyService(dbCtx.db, secrets);
    const settingsService = new SettingsService(dbCtx.db);
    const logger = new AppLogger();

    const identity = generateConsistentIdentity('windows', 'chrome');
    const profile = profileService.create({
      name: 'Gmail Profile 1',
      folderId: null,
      status: 'ready',
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
        mode: 'manual',
        timezone: 'Asia/Ho_Chi_Minh',
        language: 'vi-VN',
        lat: null,
        lon: null,
      },
      fingerprint: identity.fingerprint,
      startup: { urls: [], restoreTabs: false },
    });

    profileService.linkAccount(profile.id, 'linked@example.com');
    expect(profileService.listLinkedAccounts(profile.id)).toEqual(['linked@example.com']);
    expect(profileService.listProfilesForAccount('linked@example.com')).toEqual([
      { id: profile.id, name: 'Gmail Profile 1' },
    ]);

    // Profile backup MUST NOT contain vault secrets
    const backupJson = JSON.stringify(profileService.exportBackup());
    expect(backupJson).not.toContain('TopSecretVaultPassword!9');

    // Mock BrowserDriver to verify openGmailInProfile launches profile and opens URL without filling anything
    const openedUrls: string[] = [];
    const mockDriver: BrowserDriver = {
      name: 'mock-chrome',
      launch: async (opts) => {
        const inst: DriverInstance = {
          profileId: opts.profile.id,
          wsEndpoint: 'ws://127.0.0.1:9222/mock',
          close: async () => {},
          importCookies: async () => 0,
          exportCookies: async () => [],
          runWarmup: async () => ({ profileId: opts.profile.id, visited: 0, failed: 0 }),
          openUrl: async (url) => {
            openedUrls.push(url);
          },
        };
        return inst;
      },
      close: async () => {},
      isRunning: () => true,
      getInstance: (id) => ({
        profileId: id,
        wsEndpoint: 'ws://127.0.0.1:9222/mock',
        close: async () => {},
        importCookies: async () => 0,
        exportCookies: async () => [],
        runWarmup: async () => ({ profileId: id, visited: 0, failed: 0 }),
        openUrl: async (url) => {
          openedUrls.push(url);
        },
      }),
    };

    const launcher = new ProfileLauncher(
      profileService,
      proxyService,
      settingsService,
      logger,
      mockDriver,
      mockDriver,
    );
    const launchRes = await launcher.openGmailInProfile(profile.id, {
      url: `${mockBaseUrl}/mock-gmail`,
    });
    expect(launchRes.running).toBe(true);
    expect(openedUrls).toEqual([`${mockBaseUrl}/mock-gmail`]);

    // Deleting profile unlinks profile_accounts but MUST keep account in vault.db
    profileService.permanentDelete(profile.id);
    expect(profileService.listLinkedAccounts(profile.id)).toEqual([]);
    expect(vault.listAccounts().some((a) => a.email === 'linked@example.com')).toBe(true);

    vault.close();
    dbCtx.sqlite.close();
  });
});
