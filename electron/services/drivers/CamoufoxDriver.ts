import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { firefox } from 'playwright-core';
import type { CookieItem } from '@shared/types';
import { buildFingerprintInitScript } from '../fingerprint/injector';
import { runContextWarmup } from './warmupHelper';
import type { BrowserDriver, DriverInstance, DriverLaunchOptions } from './BrowserDriver';

function findCamoufoxBinary(customPath?: string): string | undefined {
  const candidates: string[] = [];
  if (customPath) candidates.push(customPath);
  if (process.env['CAMOUFOX_BINARY']) candidates.push(process.env['CAMOUFOX_BINARY']);

  const home = os.homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    candidates.push(path.join(localAppData, 'camoufox', 'camoufox', 'Cache', 'camoufox.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push(
      path.join(
        home,
        'Library',
        'Caches',
        'camoufox',
        'Camoufox.app',
        'Contents',
        'MacOS',
        'camoufox',
      ),
    );
  } else {
    candidates.push(path.join(home, '.cache', 'camoufox', 'camoufox'));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export class CamoufoxDriver implements BrowserDriver {
  readonly name = 'camoufox';
  private instances = new Map<string, DriverInstance>();

  isRunning(profileId: string): boolean {
    return this.instances.has(profileId);
  }

  getInstance(profileId: string): DriverInstance | undefined {
    return this.instances.get(profileId);
  }

  async launch(options: DriverLaunchOptions): Promise<DriverInstance> {
    const { profile, userDataDir, proxyServerUrl, resolvedGeo, customExecutablePath } = options;

    if (this.instances.has(profile.id)) {
      return this.instances.get(profile.id)!;
    }

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const executablePath = findCamoufoxBinary(customExecutablePath);

    // Build Camoufox native C++ config payload (consumed automatically when Camoufox binary is used)
    const camoufoxConfig: Record<string, unknown> = {
      'navigator.userAgent': profile.userAgent !== 'auto' ? profile.userAgent : undefined,
      'navigator.hardwareConcurrency': profile.fingerprint.hardware.cores,
      'screen.width': profile.fingerprint.screen.width,
      'screen.height': profile.fingerprint.screen.height,
      'window.devicePixelRatio': profile.fingerprint.screen.dpr,
      'locale:language': (resolvedGeo.language || 'en-US').split('-')[0],
      'locale:region': (resolvedGeo.language || 'en-US').split('-')[1] ?? 'US',
      timezone: resolvedGeo.timezone || undefined,
      'webrtc:ipv4': profile.fingerprint.webrtc === 'replace' ? '0.0.0.0' : undefined,
    };

    const proxyHostIsIpv6 =
      profile.proxy.type !== 'none' &&
      net.isIP(profile.proxy.host.trim().replace(/^\[|\]$/g, '')) === 6;
    const shouldBlockIpv6 = (profile.ipv6Policy ?? 'block') === 'block' && !proxyHostIsIpv6;

    const firefoxUserPrefs: Record<string, string | number | boolean> = {
      'media.peerconnection.enabled': profile.fingerprint.webrtc !== 'disable',
      'media.peerconnection.ice.default_address_only': profile.fingerprint.webrtc === 'replace',
      'media.peerconnection.ice.no_host': profile.fingerprint.webrtc === 'replace',
      'network.dns.disableIPv6': shouldBlockIpv6,
      'intl.accept_languages': resolvedGeo.language || 'en-US, en',
    };

    const context = await firefox.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath,
      userAgent: profile.userAgent !== 'auto' ? profile.userAgent : undefined,
      viewport: {
        width: Math.min(profile.fingerprint.screen.width, 1600),
        height: Math.min(profile.fingerprint.screen.height, 960),
      },
      locale: resolvedGeo.language || 'en-US',
      timezoneId: resolvedGeo.timezone || undefined,
      geolocation:
        resolvedGeo.lat !== null && resolvedGeo.lon !== null
          ? { latitude: resolvedGeo.lat, longitude: resolvedGeo.lon }
          : undefined,
      proxy: proxyServerUrl ? { server: proxyServerUrl } : undefined,
      firefoxUserPrefs,
      env: {
        ...process.env,
        CAMOU_CONFIG_1: JSON.stringify(camoufoxConfig),
      },
    });

    await context.addInitScript(buildFingerprintInitScript(profile, resolvedGeo));

    const urls = profile.startup.urls.map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      const firstPage = context.pages()[0] ?? (await context.newPage());
      await firstPage.goto(urls[0]!).catch(() => {});
      for (let i = 1; i < urls.length; i += 1) {
        const extra = await context.newPage();
        await extra.goto(urls[i]!).catch(() => {});
      }
    }

    let closed = false;
    const instance: DriverInstance = {
      profileId: profile.id,
      wsEndpoint: `camoufox://profile/${profile.id}`,
      close: async () => {
        if (closed) return;
        closed = true;
        this.instances.delete(profile.id);
        await context.close().catch(() => {});
      },
      importCookies: async (cookies: CookieItem[]): Promise<number> => {
        if (cookies.length === 0) return 0;
        await context.addCookies(
          cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            expires: c.expires > 0 ? c.expires : -1,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
          })),
        );
        return cookies.length;
      },
      exportCookies: async (): Promise<CookieItem[]> => {
        const raw = await context.cookies();
        return raw.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        }));
      },
      runWarmup: (config) => runContextWarmup(profile.id, context, config),
    };

    context.on('close', () => {
      if (!closed) {
        closed = true;
        this.instances.delete(profile.id);
        options.onUnexpectedClose(profile.id);
      }
    });

    this.instances.set(profile.id, instance);
    return instance;
  }

  async close(profileId: string): Promise<void> {
    const inst = this.instances.get(profileId);
    if (inst) {
      await inst.close();
    }
  }
}
