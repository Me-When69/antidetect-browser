import crypto from 'node:crypto';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import * as proxyChain from 'proxy-chain';
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

interface IpApiResponse {
  status?: string;
  message?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  timezone?: string;
  lat?: number;
  lon?: number;
}

export class ProxyService {
  private db: AppDatabase;
  private secrets: SecretService;
  private activeTunnels = new Map<string, string>();

  constructor(db: AppDatabase, secrets: SecretService) {
    this.db = db;
    this.secrets = secrets;
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
    // Chrome does not accept user:pass in --proxy-server, so proxy-chain creates a local tunnel.
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

  private httpGetJsonViaProxy(
    targetUrl: string,
    localHttpProxyUrl?: string,
  ): Promise<IpApiResponse> {
    return new Promise((resolve, reject) => {
      const timeoutMs = 10_000;
      if (!localHttpProxyUrl) {
        const req = http.get(targetUrl, { timeout: timeoutMs }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body) as IpApiResponse);
            } catch (err) {
              reject(err);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy(new Error('Hết thời gian chờ kết nối'));
        });
        return;
      }

      const proxyParsed = new URL(localHttpProxyUrl);
      const targetParsed = new URL(targetUrl);
      const req = http.request(
        {
          host: proxyParsed.hostname,
          port: Number(proxyParsed.port),
          method: 'GET',
          path: targetUrl,
          headers: {
            Host: targetParsed.host,
            'User-Agent': 'AntidetectBrowser/1.0',
          },
          timeout: timeoutMs,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`Proxy trả về mã lỗi HTTP ${res.statusCode ?? 500}`));
              return;
            }
            try {
              resolve(JSON.parse(body) as IpApiResponse);
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Hết thời gian chờ phản hồi từ proxy'));
      });
      req.end();
    });
  }

  async checkProxy(proxy: ProfileProxy): Promise<ProxyCheckResult> {
    const start = Date.now();
    let tempTunnel: string | null = null;
    try {
      const targetUrl =
        'http://ip-api.com/json/?fields=status,message,country,countryCode,city,lat,lon,timezone,query';

      let proxyUrl: string | undefined;
      if (proxy.type !== 'none' && proxy.host && proxy.port > 0) {
        const upstream = this.buildUpstreamUrl(proxy);
        tempTunnel = await proxyChain.anonymizeProxy(upstream);
        proxyUrl = tempTunnel;
      }

      const data = await this.httpGetJsonViaProxy(targetUrl, proxyUrl);
      const latencyMs = Date.now() - start;

      if (data.status && data.status !== 'success') {
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
          latencyMs,
          error: data.message ?? 'Không thể xác định IP đầu ra',
        };
      }

      const countryCode = data.countryCode ?? '';
      return {
        ok: true,
        ip: data.query ?? '',
        country: data.country ?? '',
        countryCode,
        city: data.city ?? '',
        timezone: data.timezone ?? '',
        lat: typeof data.lat === 'number' ? data.lat : null,
        lon: typeof data.lon === 'number' ? data.lon : null,
        language: inferLanguageFromCountry(countryCode),
        latencyMs,
      };
    } catch (err) {
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
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Lỗi kết nối proxy không xác định',
      };
    } finally {
      if (tempTunnel) {
        try {
          await proxyChain.closeAnonymizedProxy(tempTunnel, true);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
