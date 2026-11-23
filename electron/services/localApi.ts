import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { CreateProfileInput, LocalApiStatus, Profile } from '@shared/types';
import { generateConsistentIdentity, randomProfileName } from './fingerprint/generator';
import type { ProfileService } from './profileService';
import type { ProfileLauncher } from './launcher';
import type { SettingsService } from './settingsService';
import type { AppLogger } from './logger';

const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 60;

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAllowedHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  const hostOnly = hostHeader.trim().toLowerCase().replace(/:\d+$/, '');
  return hostOnly === '127.0.0.1' || hostOnly === 'localhost' || hostOnly === '[::1]';
}

function isAllowedOriginHeader(originHeader: string | undefined): boolean {
  if (!originHeader) return true;
  try {
    const parsed = new URL(originHeader);
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function redactProfileForApi(profile: Profile): Profile {
  return {
    ...profile,
    proxy: {
      ...profile.proxy,
      password: profile.proxy.password ? '[REDACTED]' : '',
      ...(profile.proxy.privateKey ? { privateKey: '[REDACTED]' } : {}),
    },
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export class LocalApiServer {
  private server: http.Server | null = null;
  private profileService: ProfileService;
  private launcher: ProfileLauncher;
  private settingsService: SettingsService;
  private logger: AppLogger;
  private runningPort = 0;
  private maxRequestsPerMinute: number;
  private requestTimestamps: number[] = [];

  constructor(
    profileService: ProfileService,
    launcher: ProfileLauncher,
    settingsService: SettingsService,
    logger: AppLogger,
    maxRequestsPerMinute = DEFAULT_MAX_REQUESTS_PER_WINDOW,
  ) {
    this.profileService = profileService;
    this.launcher = launcher;
    this.settingsService = settingsService;
    this.logger = logger;
    this.maxRequestsPerMinute = Math.max(1, maxRequestsPerMinute);
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0]! < cutoff) {
      this.requestTimestamps.shift();
    }
    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      return false;
    }
    this.requestTimestamps.push(now);
    return true;
  }

  getStatus(): LocalApiStatus {
    const settings = this.settingsService.getSettings();
    const port = this.runningPort || settings.localApiPort;
    return {
      running: this.server !== null,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
    };
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const apiKey = this.settingsService.getSettings().localApiKey;
    if (!apiKey) return false;
    const headerKey = req.headers['x-api-key'];
    if (typeof headerKey === 'string' && timingSafeEqualStr(headerKey, apiKey)) {
      return true;
    }
    const auth = req.headers['authorization'];
    if (
      typeof auth === 'string' &&
      auth.startsWith('Bearer ') &&
      timingSafeEqualStr(auth.slice(7), apiKey)
    ) {
      return true;
    }
    return false;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAllowedHostHeader(req.headers.host)) {
      sendJson(res, 403, { error: 'Forbidden: invalid Host header' });
      return;
    }
    if (!isAllowedOriginHeader(req.headers.origin)) {
      sendJson(res, 403, { error: 'Forbidden: cross-origin request denied' });
      return;
    }
    if (!this.checkRateLimit()) {
      sendJson(res, 429, { error: 'Too Many Requests: rate limit exceeded' });
      return;
    }

    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'antidetect-local-api' });
      return;
    }

    if (!this.isAuthorized(req)) {
      sendJson(res, 401, { error: 'Unauthorized: invalid or missing API key' });
      return;
    }

    try {
      // GET /profiles
      if (method === 'GET' && pathname === '/profiles') {
        const profiles = this.profileService.list();
        const runningIds = new Set(this.launcher.getRunningIds());
        sendJson(res, 200, {
          profiles: profiles.map((p) => ({
            ...redactProfileForApi(p),
            running: runningIds.has(p.id),
          })),
        });
        return;
      }

      // POST /profiles
      if (method === 'POST' && pathname === '/profiles') {
        const rawBody = await readBody(req);
        const partial = rawBody ? (JSON.parse(rawBody) as Partial<CreateProfileInput>) : {};
        const platform = partial.platform ?? 'windows';
        const browser = partial.browser ?? 'chrome';
        const identity = generateConsistentIdentity(platform, browser);

        const input: CreateProfileInput = {
          name: partial.name ?? randomProfileName(),
          folderId: partial.folderId ?? null,
          status: partial.status ?? 'none',
          tags: partial.tags ?? [],
          notes: partial.notes ?? '',
          platform: identity.platform,
          osVersion: partial.osVersion ?? identity.osVersion,
          browser: identity.browser,
          browserVersion: partial.browserVersion ?? identity.browserVersion,
          userAgent: partial.userAgent ?? identity.userAgent,
          proxy: partial.proxy ?? {
            type: 'none',
            host: '',
            port: 0,
            username: '',
            password: '',
          },
          ipv6Policy: partial.ipv6Policy ?? 'block',
          geo: partial.geo ?? {
            mode: 'auto',
            timezone: '',
            language: 'en-US',
            lat: null,
            lon: null,
          },
          fingerprint: partial.fingerprint ?? identity.fingerprint,
          startup: partial.startup ?? { urls: [], restoreTabs: false },
        };

        const created = this.profileService.create(input);
        sendJson(res, 201, { profile: redactProfileForApi(created) });
        return;
      }

      // POST /profiles/:id/start
      const startMatch = /^\/profiles\/([^/]+)\/start$/.exec(pathname);
      if (method === 'POST' && startMatch && startMatch[1]) {
        const result = await this.launcher.start(startMatch[1]);
        sendJson(res, 200, result);
        return;
      }

      // POST /profiles/:id/stop
      const stopMatch = /^\/profiles\/([^/]+)\/stop$/.exec(pathname);
      if (method === 'POST' && stopMatch && stopMatch[1]) {
        await this.launcher.stop(stopMatch[1]);
        sendJson(res, 200, { profileId: stopMatch[1], running: false });
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      this.logger.error('localApi', `${method} ${pathname}: ${message}`);
      sendJson(res, 500, { error: message });
    }
  }

  async start(port?: number): Promise<number> {
    await this.stop();
    const targetPort = port ?? this.settingsService.getSettings().localApiPort;

    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      srv.on('error', (err) => {
        this.logger.error('localApi', `Server error: ${err.message}`);
        reject(err);
      });
      srv.listen(targetPort, '127.0.0.1', () => {
        const addr = srv.address();
        this.server = srv;
        this.runningPort = addr && typeof addr === 'object' ? addr.port : targetPort;
        this.logger.info('localApi', `Listening on http://127.0.0.1:${this.runningPort}`);
        resolve(this.runningPort);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.runningPort = 0;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }
}
