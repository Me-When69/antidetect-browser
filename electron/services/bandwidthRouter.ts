import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { ProfileBandwidth } from '@shared/types';
import blocklistsRaw from '../../data/blocklists.json';

interface Blocklists {
  ads: string[];
  trackers: string[];
}

const BLOCKLISTS = blocklistsRaw as Blocklists;
const STATIC_CACHE_TYPES = new Set(['stylesheet', 'script', 'image', 'font']);

function matchesDomainList(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  for (const domain of domains) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return true;
    }
  }
  return false;
}

export function hasActiveBandwidthRules(cfg?: ProfileBandwidth | null): boolean {
  if (!cfg) return false;
  return Boolean(
    cfg.blockImages ||
      cfg.blockMedia ||
      cfg.blockExternalFonts ||
      cfg.blockAds ||
      cfg.blockTrackers ||
      cfg.cacheStaticResources,
  );
}

interface CachedResourceMeta {
  contentType: string;
  status: number;
}

export async function attachBandwidthRouter(
  context: BrowserContext,
  cfg: ProfileBandwidth | undefined,
  profileDir: string,
): Promise<void> {
  if (!hasActiveBandwidthRules(cfg) || !cfg) return;

  const cacheDir = path.join(profileDir, 'static-cache');
  if (cfg.cacheStaticResources && !fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  await context.route('**/*', async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const urlStr = request.url();

    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      await route.continue();
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      await route.continue();
      return;
    }

    // 1. Block by resource type
    if (cfg.blockImages && resourceType === 'image') {
      await route.abort('blockedbyclient');
      return;
    }
    if (cfg.blockMedia && resourceType === 'media') {
      await route.abort('blockedbyclient');
      return;
    }
    if (cfg.blockExternalFonts && resourceType === 'font') {
      let frameHost = '';
      try {
        frameHost = new URL(request.frame().url()).hostname;
      } catch {
        frameHost = '';
      }
      if (!frameHost || parsedUrl.hostname !== frameHost) {
        await route.abort('blockedbyclient');
        return;
      }
    }

    // 2. Block ads & trackers by domain list
    if (cfg.blockAds && matchesDomainList(parsedUrl.hostname, BLOCKLISTS.ads)) {
      await route.abort('blockedbyclient');
      return;
    }
    if (cfg.blockTrackers && matchesDomainList(parsedUrl.hostname, BLOCKLISTS.trackers)) {
      await route.abort('blockedbyclient');
      return;
    }

    // 3. Optional disk cache for static GET resources
    if (
      cfg.cacheStaticResources &&
      request.method() === 'GET' &&
      STATIC_CACHE_TYPES.has(resourceType)
    ) {
      const hash = crypto.createHash('sha256').update(urlStr).digest('hex');
      const bodyPath = path.join(cacheDir, `${hash}.bin`);
      const metaPath = path.join(cacheDir, `${hash}.json`);

      if (fs.existsSync(bodyPath) && fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CachedResourceMeta;
          const body = fs.readFileSync(bodyPath);
          await route.fulfill({
            status: meta.status || 200,
            contentType: meta.contentType || 'application/octet-stream',
            body,
          });
          return;
        } catch {
          // Fall through to network fetch if cache entry is corrupt
        }
      }

      try {
        const response = await route.fetch();
        const body = await response.body();
        const contentType = response.headers()['content-type'] ?? 'application/octet-stream';
        if (response.status() === 200 && body.length <= 5 * 1024 * 1024) {
          try {
            fs.writeFileSync(bodyPath, body);
            fs.writeFileSync(
              metaPath,
              JSON.stringify({ status: response.status(), contentType }),
            );
          } catch {
            // Ignore disk cache write errors
          }
        }
        await route.fulfill({ response, body });
        return;
      } catch {
        await route.continue().catch(() => {});
        return;
      }
    }

    await route.continue();
  });
}
