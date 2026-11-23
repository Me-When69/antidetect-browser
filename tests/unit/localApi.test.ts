import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { LocalApiServer } from '../../electron/services/localApi';
import { ProfileService } from '../../electron/services/profileService';
import { ProxyService } from '../../electron/services/proxyService';
import { SettingsService } from '../../electron/services/settingsService';
import { SecretService } from '../../electron/services/secretService';
import { ProfileLauncher } from '../../electron/services/launcher';
import { AppLogger } from '../../electron/services/logger';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';

function httpRequest(
  port: number,
  reqPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method: 'GET', headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('LocalApiServer Security Tests (E-004)', () => {
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

  it('rejects bad Host/Origin (DNS rebinding), enforces API key & rate limit, and redacts proxy.password', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-localapi-'));
    tempDirs.push(dir);
    const dbCtx = createDatabase(path.join(dir, 'antidetect.db'));
    const secrets = new SecretService();
    const profileService = new ProfileService(dbCtx.db, secrets, path.join(dir, 'profiles'));
    const proxyService = new ProxyService(dbCtx.db, secrets);
    const settingsService = new SettingsService(dbCtx.db);
    const logger = new AppLogger();
    const launcher = new ProfileLauncher(profileService, proxyService, settingsService, logger);

    const apiKey = settingsService.getSettings().localApiKey;
    const identity = generateConsistentIdentity('windows', 'chrome');
    profileService.create({
      name: 'API Test Profile',
      folderId: null,
      status: 'ready',
      tags: [],
      notes: '',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: identity.browser,
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: {
        type: 'http',
        host: '127.0.0.1',
        port: 8080,
        username: 'proxyuser',
        password: 'SuperSecretProxyPassword!99',
      },
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

    const api = new LocalApiServer(profileService, launcher, settingsService, logger, 5);
    const port = await api.start(0);

    try {
      // 1. DNS rebinding Host header -> 403
      const badHost = await httpRequest(port, '/health', { Host: 'evil.example.com' });
      expect(badHost.status).toBe(403);

      // 2. Cross-origin request -> 403
      const badOrigin = await httpRequest(port, '/health', { Origin: 'https://evil.example.com' });
      expect(badOrigin.status).toBe(403);

      // 3. Missing API key -> 401
      const unauth = await httpRequest(port, '/profiles');
      expect(unauth.status).toBe(401);

      // 4. Valid API key -> 200 and proxy.password MUST be redacted
      const ok = await httpRequest(port, '/profiles', { 'x-api-key': apiKey });
      expect(ok.status).toBe(200);
      expect(ok.body).not.toContain('SuperSecretProxyPassword!99');
      expect(ok.body).toContain('[REDACTED]');

      // 5. Rate limit exceeded (max 5 requests in window; 2 already counted above + 4 more -> 429)
      await httpRequest(port, '/health');
      await httpRequest(port, '/health');
      await httpRequest(port, '/health');
      const rOver = await httpRequest(port, '/health');
      expect(rOver.status).toBe(429);
    } finally {
      await api.stop();
      dbCtx.sqlite.close();
    }
  });
});
