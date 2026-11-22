import fs from 'node:fs';
import net from 'node:net';
import { firefox } from 'playwright-core';
import type { CookieItem } from '@shared/types';
import { normalizeBehavior, normalizeWindow } from '@shared/advancedDefaults';
import { resolveFirefoxExecutable } from '../browserPath';
import { buildFingerprintInitScript } from '../fingerprint/injector';
import { attachBandwidthRouter } from '../bandwidthRouter';
import { applyDiskDataOnClose, applyInContextCleanup } from '../dataCleaner';
import { runContextWarmup } from './warmupHelper';
import type { BrowserDriver, DriverInstance, DriverLaunchOptions } from './BrowserDriver';

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

    const resolvedFirefox = resolveFirefoxExecutable({ customPath: customExecutablePath });
    const executablePath = resolvedFirefox.executablePath;
    console.info(`[CamoufoxDriver] Selected browser: ${resolvedFirefox.label} (${executablePath})`);

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

    const behavior = normalizeBehavior(profile.behavior);
    const winCfg = normalizeWindow(profile.window, profile.fingerprint.screen);
    const viewportW = Math.min(winCfg.width, profile.fingerprint.screen.width);
    const viewportH = Math.min(winCfg.height, profile.fingerprint.screen.height);

    const firefoxUserPrefs: Record<string, string | number | boolean> = {
      'media.peerconnection.enabled': profile.fingerprint.webrtc !== 'disable',
      'media.peerconnection.ice.default_address_only': profile.fingerprint.webrtc === 'replace',
      'media.peerconnection.ice.no_host': profile.fingerprint.webrtc === 'replace',
      'network.dns.disableIPv6': shouldBlockIpv6,
      'intl.accept_languages': resolvedGeo.language || 'en-US, en',
      'privacy.donottrackheader.enabled': behavior.doNotTrack,
      'permissions.default.desktop-notification': behavior.notifications === 'block' ? 2 : 0,
      'layers.acceleration.disabled': !behavior.hardwareAcceleration,
      'geo.enabled': behavior.geolocationPrompt !== 'block',
      'permissions.default.geo':
        behavior.geolocationPrompt === 'block'
          ? 2
          : behavior.geolocationPrompt === 'allow'
            ? 1
            : 0,
      'signon.rememberSignons': !behavior.disableAutofill,
      'extensions.formautofill.addresses.enabled': !behavior.disableAutofill,
      'extensions.formautofill.creditCards.enabled': !behavior.disableAutofill,
    };

    const context = await firefox.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath,
      userAgent: profile.userAgent !== 'auto' ? profile.userAgent : undefined,
      viewport: {
        width: viewportW,
        height: viewportH,
      },
      locale: resolvedGeo.language || 'en-US',
      timezoneId: resolvedGeo.timezone || undefined,
      geolocation:
        behavior.geolocationPrompt !== 'block' &&
        resolvedGeo.lat !== null &&
        resolvedGeo.lon !== null
          ? { latitude: resolvedGeo.lat, longitude: resolvedGeo.lon }
          : undefined,
      proxy: proxyServerUrl
        ? {
            server: proxyServerUrl,
            ...(options.proxyUsername ? { username: options.proxyUsername } : {}),
            ...(options.proxyPassword ? { password: options.proxyPassword } : {}),
          }
        : undefined,
      firefoxUserPrefs,
      env: {
        ...process.env,
        CAMOU_CONFIG_1: JSON.stringify(camoufoxConfig),
      },
    });

    await attachBandwidthRouter(context, profile.bandwidth, userDataDir);
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
