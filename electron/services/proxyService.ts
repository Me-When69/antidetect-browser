import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { eq } from 'drizzle-orm';
import * as proxyChain from 'proxy-chain';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { AppDatabase } from '../db';
import { proxiesTable } from '../db/schema';
import type {
  CreateSavedProxyInput,
  ProfileProxy,
  ProxyCheckResult,
  SavedProxy,
} from '@shared/types';
import { inferLanguageFromCountry } from '@shared/validation';
import type { SecretService } from './secretService';

export interface NormalizedIpInfo {
  ip: string;
  country: string;
  countryCode: string;
  city: string;
  timezone: string;
  lat: number | null;
  lon: number | null;
}

export type ProxyHttpFetcher = (
  url: string,
  proxy: ProfileProxy,
  timeoutMs: number,
) => Promise<{ statusCode: number; body: string }>;

const CHECK_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  result: ProxyCheckResult;
}

interface IpProvider {
  name: string;
  url: string;
  parse: (json: Record<string, unknown>) => NormalizedIpInfo | null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export const IP_PROVIDERS: readonly IpProvider[] = [
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    parse: (j) => {
      if (j['error']) return null;
      const ip = asString(j['ip']);
      if (!ip) return null;
      return {
        ip,
        country: asString(j['country_name']) || asString(j['country']),
        countryCode: asString(j['country_code']) || asString(j['country']),
        city: asString(j['city']),
        timezone: asString(j['timezone']),
        lat: asNumberOrNull(j['latitude']),
        lon: asNumberOrNull(j['longitude']),
      };
    },
  },
  {
    name: 'ip-api.com',
    url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,city,lat,lon,timezone,query',
    parse: (j) => {
      if (j['status'] && j['status'] !== 'success') return null;
      const ip = asString(j['query']);
      if (!ip) return null;
      return {
        ip,
        country: asString(j['country']),
        countryCode: asString(j['countryCode']),
        city: asString(j['city']),
        timezone: asString(j['timezone']),
        lat: asNumberOrNull(j['lat']),
        lon: asNumberOrNull(j['lon']),
      };
    },
  },
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    parse: (j) => {
      if (j['success'] === false) return null;
      const ip = asString(j['ip']);
      if (!ip) return null;
      const tzObj = j['timezone'];
      const tzId =
        typeof tzObj === 'object' && tzObj !== null
          ? asString((tzObj as Record<string, unknown>)['id'])
          : asString(tzObj);
      return {
        ip,
        country: asString(j['country']),
        countryCode: asString(j['country_code']),
        city: asString(j['city']),
        timezone: tzId,
        lat: asNumberOrNull(j['latitude']),
        lon: asNumberOrNull(j['longitude']),
      };
    },
  },
];

function scrubSecrets(text: string): string {
  return text.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/g, '//***:***@');
}

export function classifyProxyError(err: unknown, statusCode?: number): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const combined = `${code} ${msg}`;

  if (statusCode === 407 || /\b407\b|proxy authentication/i.test(combined)) {
    return 'Sai tài khoản/mật khẩu hoặc chưa whitelist IP';
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(combined)) {
    return 'Proxy từ chối kết nối, kiểm tra host/port hoặc dịch vụ proxy';
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout|timed out/i.test(combined)) {
    return 'Hết thời gian chờ, proxy chậm hoặc bị chặn';
  }
  if (code === 'ENOTFOUND' || /ENOTFOUND|EAI_AGAIN/i.test(combined)) {
    return 'Không tìm thấy host proxy';
  }

  const clean = scrubSecrets(msg || (statusCode ? `HTTP ${statusCode}` : 'Lỗi kết nối proxy'));
  return clean.length > 140 ? `${clean.slice(0, 140)}...` : clean;
}

export function hashProxyConfig(proxy: ProfileProxy): string {
  const payload = `${proxy.type}|${proxy.host.trim()}|${proxy.port}|${proxy.username}|${proxy.password}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function buildAgent(proxy: ProfileProxy): http.Agent | undefined {
  if (proxy.type === 'none' || !proxy.host || proxy.port <= 0) {
    return undefined;
  }
  const auth =
    proxy.username || proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : '';
  const url = `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
  if (proxy.type === 'socks5') {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}

const defaultProxyFetcher: ProxyHttpFetcher = (targetUrl, proxy, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const agent = buildAgent(proxy);
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        agent,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'AntidetectBrowser/1.0',
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      const timeoutErr = new Error('ETIMEDOUT') as NodeJS.ErrnoException;
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
    });
    req.end();
  });
};

export class ProxyService {
  private db: AppDatabase;
  private secrets: SecretService;
  private activeTunnels = new Map<string, string>();
  private checkCache = new Map<string, CacheEntry>();
  private fetcher: ProxyHttpFetcher;

  constructor(
    db: AppDatabase,
    secrets: SecretService,
    fetcher: ProxyHttpFetcher = defaultProxyFetcher,
  ) {
    this.db = db;
    this.secrets = secrets;
    this.fetcher = fetcher;
  }

  clearCheckCache(): void {
    this.checkCache.clear();
  }

  list(): SavedProxy[] {
    return this.db
      .select()
      .from(proxiesTable)
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type as SavedProxy['type'],
        host: row.host,
        port: row.port,
        username: row.username,
        password: this.secrets.decrypt(row.passwordEnc),
        country: row.country,
        createdAt: row.createdAt,
      }));
  }

  create(input: CreateSavedProxyInput): SavedProxy {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .insert(proxiesTable)
      .values({
        id,
        name: input.name.trim() || `${input.host}:${input.port}`,
        type: input.type,
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        passwordEnc: this.secrets.encrypt(input.password),
        country: input.country.trim(),
        createdAt,
      })
      .run();

    return {
      ...input,
      id,
      name: input.name.trim() || `${input.host}:${input.port}`,
      createdAt,
    };
  }

  update(id: string, input: Partial<CreateSavedProxyInput>): SavedProxy {
    const existing = this.list().find((p) => p.id === id);
    if (!existing) {
      throw new Error(`Proxy not found: ${id}`);
    }
    const merged: SavedProxy = { ...existing, ...input };
    this.db
      .update(proxiesTable)
      .set({
        name: merged.name,
        type: merged.type,
        host: merged.host,
        port: merged.port,
        username: merged.username,
        passwordEnc: this.secrets.encrypt(merged.password),
        country: merged.country,
      })
      .where(eq(proxiesTable.id, id))
      .run();
    return merged;
  }

  delete(id: string): void {
    this.db.delete(proxiesTable).where(eq(proxiesTable.id, id)).run();
  }

  buildUpstreamUrl(proxy: ProfileProxy): string {
    const auth =
      proxy.username || proxy.password
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
        : '';
    return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
  }

  async openTunnelForProfile(profileId: string, proxy: ProfileProxy): Promise<string | null> {
    if (proxy.type === 'none' || !proxy.host || !proxy.port) {
      return null;
    }

    await this.closeTunnelForProfile(profileId);

    const upstream = this.buildUpstreamUrl(proxy);
    if (proxy.username || proxy.password) {
      const localUrl = await proxyChain.anonymizeProxy(upstream);
      this.activeTunnels.set(profileId, localUrl);
      return localUrl;
    }

    return upstream;
  }

  async closeTunnelForProfile(profileId: string): Promise<void> {
    const localUrl = this.activeTunnels.get(profileId);
    if (localUrl) {
      this.activeTunnels.delete(profileId);
      try {
        await proxyChain.closeAnonymizedProxy(localUrl, true);
      } catch {
        // Ignore already-closed tunnel
      }
    }
  }

  async closeAllTunnels(): Promise<void> {
    const ids = Array.from(this.activeTunnels.keys());
    for (const id of ids) {
      await this.closeTunnelForProfile(id);
    }
  }

  async checkProxy(proxy: ProfileProxy, bypassCache = false): Promise<ProxyCheckResult> {
    const cacheKey = hashProxyConfig(proxy);
    if (!bypassCache) {
      const cached = this.checkCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    }

    let lastError = 'Không thể kết nối tới proxy';
    const overallStart = Date.now();

    for (const provider of IP_PROVIDERS) {
      const attemptStart = Date.now();
      try {
        const response = await this.fetcher(provider.url, proxy, CHECK_TIMEOUT_MS);
        if (response.statusCode === 407) {
          // Proxy auth error fails fast — no need to retry other APIs
          return {
            ok: false,
            ip: '',
            country: '',
            countryCode: '',
            city: '',
            timezone: '',
            lat: null,
            lon: null,
            language: 'en-US',
            latencyMs: Date.now() - attemptStart,
            error: classifyProxyError(null, 407),
          };
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          lastError = classifyProxyError(
            new Error(`HTTP ${response.statusCode}`),
            response.statusCode,
          );
          continue;
        }

        const parsedJson = JSON.parse(response.body) as Record<string, unknown>;
        const normalized = provider.parse(parsedJson);
        if (!normalized) {
          lastError = `API ${provider.name} trả về dữ liệu không hợp lệ hoặc bị giới hạn`;
          continue;
        }

        const result: ProxyCheckResult = {
          ok: true,
          ip: normalized.ip,
          country: normalized.country,
          countryCode: normalized.countryCode,
          city: normalized.city,
          timezone: normalized.timezone,
          lat: normalized.lat,
          lon: normalized.lon,
          language: inferLanguageFromCountry(normalized.countryCode),
          latencyMs: Date.now() - attemptStart,
        };

        this.checkCache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          result,
        });
        return result;
      } catch (err) {
        const classified = classifyProxyError(err);
        lastError = classified;
        // Connection-level proxy failures fail fast without hammering fallback APIs
        const rawCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code ?? '')
            : '';
        if (rawCode === 'ECONNREFUSED' || rawCode === 'ENOTFOUND') {
          return {
            ok: false,
            ip: '',
            country: '',
            countryCode: '',
            city: '',
            timezone: '',
            lat: null,
            lon: null,
            language: 'en-US',
            latencyMs: Date.now() - attemptStart,
            error: classified,
          };
        }
      }
    }

    return {
      ok: false,
      ip: '',
      country: '',
      countryCode: '',
      city: '',
      timezone: '',
      lat: null,
      lon: null,
      language: 'en-US',
      latencyMs: Date.now() - overallStart,
      error: lastError,
    };
  }
}
