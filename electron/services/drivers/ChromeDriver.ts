import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { CookieItem, Platform, Profile } from '@shared/types';
import { normalizeBehavior, normalizeWindow } from '@shared/advancedDefaults';
import { resolveBrowserExecutable } from '../browserPath';
import { CHROME_NO_AUTOUPDATE_ARGS } from '../browserManager';
import { buildFingerprintInitScript } from '../fingerprint/injector';
import { attachBandwidthRouter } from '../bandwidthRouter';
import { applyDiskDataOnClose, applyInContextCleanup } from '../dataCleaner';
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

function getCdpNavPlatform(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Win32';
    case 'macos':
      return 'MacIntel';
    case 'linux':
      return 'Linux x86_64';
    case 'android':
      return 'Linux armv8l';
    case 'ios':
      return 'iPhone';
  }
}

function getCdpUaPlatform(platform: Platform): string {
  switch (platform) {
    case 'windows':
      return 'Windows';
    case 'macos':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'android':
      return 'Android';
    case 'ios':
      return 'iOS';
  }
}

async function applyCdpOverrides(
  context: BrowserContext,
  page: Page,
  profile: Profile,
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

    const isMobile =
      profile.fingerprint.mobile ?? (profile.platform === 'android' || profile.platform === 'ios');
    const isIos = profile.platform === 'ios';

    // User-Agent & Client Hints override via CDP (also propagates to Workers and HTTP headers)
    if (profile.userAgent && profile.userAgent !== 'auto') {
      const major = profile.browserVersion.split('.')[0] ?? '136';
      const fullVersion = profile.browserVersion;
      const defaultArch =
        profile.platform === 'macos' || profile.platform === 'android' ? 'arm' : 'x86';
      const defaultPlatformVersion =
        profile.platform === 'windows'
          ? profile.osVersion.includes('11')
            ? '15.0.0'
            : '10.0.0'
          : profile.platform === 'macos'
            ? '14.5.0'
            : profile.platform === 'android'
              ? '14.0.0'
              : '6.5.0';

      if (isIos) {
        // NEVER send Chrome userAgentMetadata for iOS
        await cdp
          .send('Emulation.setUserAgentOverride', {
            userAgent: profile.userAgent,
            acceptLanguage: geo.acceptLanguage || 'en-US,en;q=0.9',
            platform: 'iPhone',
          })
          .catch(() => {});
      } else {
        await cdp
          .send('Emulation.setUserAgentOverride', {
            userAgent: profile.userAgent,
            acceptLanguage: geo.acceptLanguage || 'en-US,en;q=0.9',
            platform: getCdpNavPlatform(profile.platform),
            userAgentMetadata: {
              brands: [
                { brand: 'Google Chrome', version: major },
                { brand: 'Chromium', version: major },
                { brand: 'Not_A Brand', version: '24' },
              ],
              fullVersionList: [
                { brand: 'Google Chrome', version: fullVersion },
                { brand: 'Chromium', version: fullVersion },
                { brand: 'Not_A Brand', version: '24.0.0.0' },
              ],
              fullVersion,
              platform: getCdpUaPlatform(profile.platform),
              platformVersion: profile.fingerprint.platformVersion || defaultPlatformVersion,
              architecture: profile.fingerprint.architecture || defaultArch,
              model: profile.fingerprint.model ?? '',
              mobile: isMobile,
              bitness: profile.fingerprint.bitness || '64',
            },
          })
          .catch(() => {});
      }
    }

    // Mobile device metrics & touch emulation (Android / iOS)
    if (isMobile) {
      const width = profile.fingerprint.screen.width;
      const height = profile.fingerprint.screen.height;
      const dpr = profile.fingerprint.screen.dpr || 3;
      const maxTouchPoints = profile.fingerprint.maxTouchPoints ?? 5;
      await cdp
        .send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: dpr,
          mobile: true,
          screenWidth: width,
          screenHeight: height,
          screenOrientation: {
            type: width > height ? 'landscapePrimary' : 'portraitPrimary',
            angle: width > height ? 90 : 0,
          },
        })
        .catch(() => {});
      await cdp
        .send('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          maxTouchPoints,
        })
        .catch(() => {});
      await cdp
        .send('Emulation.setEmitTouchEventsForMouse', {
          enabled: true,
          configuration: 'mobile',
        })
        .catch(() => {});
    }
  } catch {
    // Ignore CDP errors on closed pages
  }
}

function computeWindowSize(profile: Profile): {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
} {
  const screenW = profile.fingerprint.screen.width || 1920;
  const screenH = profile.fingerprint.screen.height || 1080;
  const win = normalizeWindow(profile.window, { width: screenW, height: screenH });
  let width = Math.min(win.width, screenW);
  let height = Math.min(win.height, screenH);
  if (win.randomizeSlightly) {
    const seed = profile.fingerprint.canvasNoiseSeed || 1;
    const dx = ((Math.abs(seed * 31) % 17) - 8); // -8..+8 px deterministic
    const dy = ((Math.abs(seed * 17) % 17) - 8);
    width = Math.max(320, Math.min(screenW, width + dx));
    height = Math.max(240, Math.min(screenH, height + dy));
  }
  return {
    width,
    height,
    x: win.x ?? null,
    y: win.y ?? null,
    maximized: win.maximized,
  };
}

function writeChromeBehaviorPrefs(userDataDir: string, profile: Profile): void {
  const behavior = normalizeBehavior(profile.behavior);
  const defaultDir = path.join(userDataDir, 'Default');
  const prefsPath = path.join(defaultDir, 'Preferences');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    let prefs: Record<string, unknown> = {};
    if (fs.existsSync(prefsPath)) {
      try {
        prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as Record<string, unknown>;
      } catch {
        prefs = {};
      }
    }
    const profileObj =
      typeof prefs['profile'] === 'object' && prefs['profile'] !== null
        ? (prefs['profile'] as Record<string, unknown>)
        : {};
    const contentSettings =
      typeof profileObj['default_content_setting_values'] === 'object' &&
      profileObj['default_content_setting_values'] !== null
        ? (profileObj['default_content_setting_values'] as Record<string, unknown>)
        : {};

    contentSettings['notifications'] = behavior.notifications === 'block' ? 2 : 0;
    if (behavior.geolocationPrompt === 'block') {
      contentSettings['geolocation'] = 2;
    } else if (behavior.geolocationPrompt === 'allow') {
      contentSettings['geolocation'] = 1;
    } else {
      contentSettings['geolocation'] = 0;
    }
    profileObj['default_content_setting_values'] = contentSettings;
    prefs['profile'] = profileObj;

    if (behavior.disableAutofill) {
      prefs['autofill'] = {
        profile_enabled: false,
        credit_card_enabled: false,
      };
      prefs['credentials_enable_service'] = false;
    }
    if (behavior.doNotTrack) {
      prefs['enable_do_not_track'] = true;
    }

    fs.writeFileSync(prefsPath, JSON.stringify(prefs), 'utf8');
  } catch {
    // Ignore preference write errors
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

    const behavior = normalizeBehavior(profile.behavior);
    const winCfg = computeWindowSize(profile);
    writeChromeBehaviorPrefs(userDataDir, profile);

    const args: string[] = [
      `--remote-debugging-port=${debugPort}`,
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--metrics-recording-only',
      '--disable-breakpad',
      '--disable-domain-reliability',
      ...CHROME_NO_AUTOUPDATE_ARGS,
      `--window-size=${winCfg.width},${winCfg.height}`,
    ];

    if (winCfg.x !== null && winCfg.y !== null) {
      args.push(`--window-position=${winCfg.x},${winCfg.y}`);
    }
    if (winCfg.maximized) {
      args.push('--start-maximized');
    }
    if (!behavior.hardwareAcceleration) {
      args.push('--disable-gpu');
    }
    if (behavior.disableGoogleSync) {
      args.push('--disable-sync');
    }

    // Load unpacked Chromium extensions if provided and present on disk
    const validExtensions = (profile.startup.extensions ?? [])
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0 && fs.existsSync(ext));
    if (validExtensions.length > 0) {
      const joined = validExtensions.join(',');
      args.push(`--disable-extensions-except=${joined}`);
      args.push(`--load-extension=${joined}`);
    }

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
    const extraHeaders: Record<string, string> = {
      'Accept-Language': acceptLang,
      ...(behavior.doNotTrack ? { DNT: '1' } : {}),
    };
    const isMobile =
      profile.fingerprint.mobile ?? (profile.platform === 'android' || profile.platform === 'ios');
    const allowGeoPermission =
      behavior.geolocationPrompt === 'allow' &&
      resolvedGeo.lat !== null &&
      resolvedGeo.lon !== null;

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath: executablePath || undefined,
      channel: executablePath ? undefined : 'chrome',
      userAgent: profile.userAgent !== 'auto' ? profile.userAgent : undefined,
      viewport: isMobile
        ? { width: profile.fingerprint.screen.width, height: profile.fingerprint.screen.height }
        : null,
      deviceScaleFactor: isMobile ? profile.fingerprint.screen.dpr || 3 : undefined,
      isMobile: isMobile ? true : undefined,
      hasTouch: isMobile ? true : undefined,
      locale: resolvedGeo.language || 'en-US',
      timezoneId: resolvedGeo.timezone || undefined,
      geolocation:
        behavior.geolocationPrompt !== 'block' &&
        resolvedGeo.lat !== null &&
        resolvedGeo.lon !== null
          ? {
              latitude: resolvedGeo.lat,
              longitude: resolvedGeo.lon,
              accuracy: resolvedGeo.accuracy ?? 50,
            }
          : undefined,
      permissions: allowGeoPermission ? ['geolocation'] : [],
      extraHTTPHeaders: extraHeaders,
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

    await context.setExtraHTTPHeaders(extraHeaders);
    if (allowGeoPermission) {
      await context.grantPermissions(['geolocation']).catch(() => {});
    }

    await attachBandwidthRouter(context, profile.bandwidth, userDataDir);
    await context.addInitScript(buildFingerprintInitScript(profile, resolvedGeo));

    // Apply CDP overrides to existing and new pages
    context.on('page', (page) => {
      void applyCdpOverrides(context, page, profile, resolvedGeo);
    });
    for (const page of context.pages()) {
      await applyCdpOverrides(context, page, profile, resolvedGeo);
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
        await applyInContextCleanup(context, profile.dataOnClose);
        await context.close().catch(() => {});
        applyDiskDataOnClose(userDataDir, profile.dataOnClose);
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
        applyDiskDataOnClose(userDataDir, profile.dataOnClose);
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
