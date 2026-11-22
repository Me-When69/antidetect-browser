import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { CookieItem } from '@shared/types';
import { resolveBrowserExecutable } from '../browserPath';
import { CHROME_NO_AUTOUPDATE_ARGS } from '../browserManager';
import { buildFingerprintInitScript } from '../fingerprint/injector';
import { runContextWarmup } from './warmupHelper';
import type {
  BrowserDriver,
  DriverInstance,
  DriverLaunchOptions,
  ResolvedGeo,
} from './BrowserDriver';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('Could not allocate free port'));
        }
      });
    });
    server.on('error', reject);
  });
}

function fetchCdpWsEndpoint(port: number): Promise<string> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 3000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { webSocketDebuggerUrl?: string };
          resolve(parsed.webSocketDebuggerUrl ?? `http://127.0.0.1:${port}`);
        } catch {
          resolve(`http://127.0.0.1:${port}`);
        }
      });
    });
    req.on('error', () => resolve(`http://127.0.0.1:${port}`));
    req.on('timeout', () => {
      req.destroy();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function applyCdpOverrides(
  context: BrowserContext,
  page: Page,
  geo: ResolvedGeo,
): Promise<void> {
  try {
    const cdp = await context.newCDPSession(page);
    if (geo.timezone) {
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: geo.timezone }).catch(() => {});
    }
    if (geo.language) {
      await cdp.send('Emulation.setLocaleOverride', { locale: geo.language }).catch(() => {});
      await cdp
        .send('Network.setExtraHTTPHeaders', {
          headers: { 'Accept-Language': geo.acceptLanguage },
        })
        .catch(() => {});
    }
    if (geo.lat !== null && geo.lon !== null) {
      await cdp
        .send('Emulation.setGeolocationOverride', {
          latitude: geo.lat,
          longitude: geo.lon,
          accuracy: geo.accuracy ?? 50,
        })
        .catch(() => {});
    }
  } catch {
    // Ignore CDP errors on closed pages
  }
}

export class ChromeDriver implements BrowserDriver {
  readonly name = 'chrome';
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

    const debugPort = await getFreePort();
    const resolvedBrowser = resolveBrowserExecutable({ customPath: customExecutablePath });
    const executablePath = resolvedBrowser.executablePath;
    console.info(`[ChromeDriver] Selected browser: ${resolvedBrowser.label} (${executablePath})`);

    const args: string[] = [
      `--remote-debugging-port=${debugPort}`,
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      ...CHROME_NO_AUTOUPDATE_ARGS,
      `--window-size=${profile.fingerprint.screen.width},${profile.fingerprint.screen.height}`,
    ];

    const proxyHostIsIpv6 =
      profile.proxy.type !== 'none' &&
      net.isIP(profile.proxy.host.trim().replace(/^\[|\]$/g, '')) === 6;
    const shouldBlockIpv6 = (profile.ipv6Policy ?? 'block') === 'block' && !proxyHostIsIpv6;

    if (shouldBlockIpv6) {
      args.push('--disable-ipv6');
    }

    if (
      profile.fingerprint.webrtc === 'replace' ||
      profile.fingerprint.webrtc === 'disable' ||
      shouldBlockIpv6 ||
      profile.ipv6Policy === 'proxy-only'
    ) {
      args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
      args.push('--enforce-webrtc-ip-permission-check');
    }

    const acceptLang = resolvedGeo.acceptLanguage || 'en-US,en;q=0.9';

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath: executablePath || undefined,
      channel: executablePath ? undefined : 'chrome',
      userAgent: profile.userAgent !== 'auto' ? profile.userAgent : undefined,
      viewport: null,
      locale: resolvedGeo.language || 'en-US',
      timezoneId: resolvedGeo.timezone || undefined,
      geolocation:
        resolvedGeo.lat !== null && resolvedGeo.lon !== null
          ? {
              latitude: resolvedGeo.lat,
              longitude: resolvedGeo.lon,
              accuracy: resolvedGeo.accuracy ?? 50,
            }
          : undefined,
      permissions: resolvedGeo.lat !== null && resolvedGeo.lon !== null ? ['geolocation'] : [],
      extraHTTPHeaders: {
        'Accept-Language': acceptLang,
      },
      proxy: proxyServerUrl
        ? {
            server: proxyServerUrl,
            ...(options.proxyUsername ? { username: options.proxyUsername } : {}),
            ...(options.proxyPassword ? { password: options.proxyPassword } : {}),
          }
        : undefined,
      args,
      ignoreDefaultArgs: ['--enable-automation'],
    });

    await context.setExtraHTTPHeaders({ 'Accept-Language': acceptLang });
    if (resolvedGeo.lat !== null && resolvedGeo.lon !== null) {
      await context.grantPermissions(['geolocation']).catch(() => {});
    }

    await context.addInitScript(buildFingerprintInitScript(profile, resolvedGeo));

    // Apply CDP overrides to existing and new pages
    context.on('page', (page) => {
      void applyCdpOverrides(context, page, resolvedGeo);
    });
    for (const page of context.pages()) {
      await applyCdpOverrides(context, page, resolvedGeo);
    }

    // Open startup URLs
    const urls = profile.startup.urls.map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      const firstPage = context.pages()[0] ?? (await context.newPage());
      await firstPage.goto(urls[0]!).catch(() => {});
      for (let i = 1; i < urls.length; i += 1) {
        const extra = await context.newPage();
        await extra.goto(urls[i]!).catch(() => {});
      }
    }

    const wsEndpoint = await fetchCdpWsEndpoint(debugPort);

    let closed = false;
    const instance: DriverInstance = {
      profileId: profile.id,
      wsEndpoint,
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
