import fs from 'node:fs';
import path from 'node:path';
import type {
  CookieItem,
  LaunchOptions,
  LaunchResult,
  Profile,
  ProfileRunStatusEvent,
  WarmupConfig,
  WarmupResult,
} from '@shared/types';
import { parseCookiesText, serializeCookiesNetscape } from '@shared/validation';
import { buildAcceptLanguage, deriveGeo } from './geoService';
import type { BrowserDriver, ResolvedGeo } from './drivers/BrowserDriver';
import { ChromeDriver } from './drivers/ChromeDriver';
import { CamoufoxDriver } from './drivers/CamoufoxDriver';
import type { ProfileService } from './profileService';
import type { ProxyService } from './proxyService';
import type { SettingsService } from './settingsService';
import type { AppLogger } from './logger';

type StatusListener = (event: ProfileRunStatusEvent) => void;

export class ProfileLauncher {
  private profileService: ProfileService;
  private proxyService: ProxyService;
  private settingsService: SettingsService;
  private logger: AppLogger;
  private chromeDriver: BrowserDriver;
  private camoufoxDriver: BrowserDriver;
  private runningDrivers = new Map<string, BrowserDriver>();
  private listeners = new Set<StatusListener>();

  constructor(
    profileService: ProfileService,
    proxyService: ProxyService,
    settingsService: SettingsService,
    logger: AppLogger,
    chromeDriver: BrowserDriver = new ChromeDriver(),
    camoufoxDriver: BrowserDriver = new CamoufoxDriver(),
  ) {
    this.profileService = profileService;
    this.proxyService = proxyService;
    this.settingsService = settingsService;
    this.logger = logger;
    this.chromeDriver = chromeDriver;
    this.camoufoxDriver = camoufoxDriver;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitStatus(event: ProfileRunStatusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private pickDriver(profile: Profile): BrowserDriver {
    return profile.browser === 'firefox' ? this.camoufoxDriver : this.chromeDriver;
  }

  private getStagedCookiesPath(profileId: string): string {
    return path.join(this.profileService.getProfileDir(profileId), 'staged-cookies.json');
  }

  getRunningIds(): string[] {
    return Array.from(this.runningDrivers.keys());
  }

  isRunning(profileId: string): boolean {
    return this.runningDrivers.has(profileId);
  }

  private async resolveGeo(
    profile: Profile,
    useFallbackGeo: boolean,
  ): Promise<
    { ok: true; geo: ResolvedGeo; updatedProfile: Profile } | { ok: false; error: string }
  > {
    if (profile.geo.mode === 'manual' || useFallbackGeo) {
      const lang = profile.geo.language || 'en-US';
      return {
        ok: true,
        updatedProfile: profile,
        geo: {
          timezone: profile.geo.timezone,
          language: lang,
          acceptLanguage: buildAcceptLanguage(lang),
          lat: profile.geo.lat,
          lon: profile.geo.lon,
          accuracy: 50,
        },
      };
    }

    // Auto mode: check proxy IP first; if check fails, do NOT open browser unless user confirms fallback
    const check = await this.proxyService.checkProxy(profile.proxy);
    if (!check.ok) {
      return {
        ok: false,
        error: check.error ?? 'Không thể kiểm tra IP proxy để tự khớp vị trí/múi giờ',
      };
    }

    const derived = deriveGeo(
      {
        countryCode: check.countryCode,
        timezone: check.timezone,
        lat: check.lat,
        lon: check.lon,
      },
      profile.id,
    );

    // Persist newly derived geo into DB
    const updatedProfile = this.profileService.update({
      id: profile.id,
      geo: {
        mode: 'auto',
        timezone: derived.timezone,
        language: derived.locale,
        lat: derived.geolocation?.latitude ?? null,
        lon: derived.geolocation?.longitude ?? null,
      },
    });

    return {
      ok: true,
      updatedProfile,
      geo: {
        timezone: derived.timezone,
        language: derived.locale,
        acceptLanguage: derived.acceptLanguage,
        lat: derived.geolocation?.latitude ?? null,
        lon: derived.geolocation?.longitude ?? null,
        accuracy: derived.geolocation?.accuracy ?? 50,
      },
    };
  }

  async start(profileId: string, options?: LaunchOptions): Promise<LaunchResult> {
    const profile = this.profileService.getById(profileId);
    if (!profile) {
      throw new Error(`Không tìm thấy hồ sơ: ${profileId}`);
    }

    const existingDriver = this.runningDrivers.get(profileId);
    if (existingDriver) {
      const existingInst = existingDriver.getInstance(profileId);
      if (existingInst) {
        return {
          profileId,
          running: true,
          wsEndpoint: existingInst.wsEndpoint,
        };
      }
    }

    const driver = this.pickDriver(profile);
    const settings = this.settingsService.getSettings();
    const userDataDir = this.profileService.getProfileDir(profileId);

    this.logger.info(
      'launcher',
      `Starting profile ${profile.name} (${profileId}) via ${driver.name}`,
    );

    const geoResolution = await this.resolveGeo(profile, Boolean(options?.useFallbackGeo));
    if (!geoResolution.ok) {
      this.logger.warn(
        'launcher',
        `Aborted launch for ${profileId}: proxy geo check failed (${geoResolution.error})`,
      );
      return {
        profileId,
        running: false,
        wsEndpoint: '',
        proxyCheckFailed: true,
        error: geoResolution.error,
      };
    }

    const proxyServerUrl = await this.proxyService.openTunnelForProfile(profileId, profile.proxy);

    try {
      const instance = await driver.launch({
        profile: geoResolution.updatedProfile,
        userDataDir,
        proxyServerUrl,
        resolvedGeo: geoResolution.geo,
        customExecutablePath:
          profile.browser === 'firefox' ? settings.camoufoxPath : settings.chromePath,
        onUnexpectedClose: (closedId) => {
          this.runningDrivers.delete(closedId);
          void this.proxyService.closeTunnelForProfile(closedId);
          this.logger.info('launcher', `Profile closed by user: ${closedId}`);
          this.emitStatus({ profileId: closedId, running: false });
        },
      });

      this.runningDrivers.set(profileId, driver);
      this.profileService.touchLastRun(profileId);

      // Apply any staged cookies imported while offline
      const stagedPath = this.getStagedCookiesPath(profileId);
      if (fs.existsSync(stagedPath)) {
        try {
          const staged = JSON.parse(fs.readFileSync(stagedPath, 'utf8')) as CookieItem[];
          if (staged.length > 0) {
            await instance.importCookies(staged);
          }
          fs.unlinkSync(stagedPath);
        } catch {
          // Ignore malformed staged cookies
        }
      }

      this.emitStatus({ profileId, running: true, wsEndpoint: instance.wsEndpoint });

      return {
        profileId,
        running: true,
        wsEndpoint: instance.wsEndpoint,
      };
    } catch (err) {
      await this.proxyService.closeTunnelForProfile(profileId);
      const msg = err instanceof Error ? err.message : 'Lỗi khởi chạy trình duyệt';
      this.logger.error('launcher', `Failed to launch ${profileId}: ${msg}`);
      this.emitStatus({ profileId, running: false, error: msg });
      throw err;
    }
  }

  async stop(profileId: string): Promise<void> {
    const driver = this.runningDrivers.get(profileId);
    if (driver) {
      this.runningDrivers.delete(profileId);
      await driver.close(profileId);
    }
    await this.proxyService.closeTunnelForProfile(profileId);
    this.logger.info('launcher', `Stopped profile ${profileId}`);
    this.emitStatus({ profileId, running: false });
  }

  async bulkStart(profileIds: string[]): Promise<LaunchResult[]> {
    const results: LaunchResult[] = [];
    for (const id of profileIds) {
      try {
        results.push(await this.start(id));
      } catch (err) {
        this.logger.warn(
          'launcher',
          `Bulk start skipped ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return results;
  }

  async bulkStop(profileIds: string[]): Promise<void> {
    await Promise.all(profileIds.map((id) => this.stop(id)));
  }

  async stopAll(): Promise<void> {
    const ids = this.getRunningIds();
    await this.bulkStop(ids);
    await this.proxyService.closeAllTunnels();
  }

  async importCookies(profileId: string, rawText: string): Promise<number> {
    const cookies = parseCookiesText(rawText);
    if (cookies.length === 0) {
      return 0;
    }
    const driver = this.runningDrivers.get(profileId);
    const inst = driver?.getInstance(profileId);
    if (inst) {
      return inst.importCookies(cookies);
    }
    const dir = this.profileService.getProfileDir(profileId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.getStagedCookiesPath(profileId),
      JSON.stringify(cookies, null, 2),
      'utf8',
    );
    return cookies.length;
  }

  async exportCookies(profileId: string, format: 'json' | 'netscape'): Promise<string> {
    const driver = this.runningDrivers.get(profileId);
    const inst = driver?.getInstance(profileId);
    let cookies: CookieItem[] = [];
    if (inst) {
      cookies = await inst.exportCookies();
    } else {
      const stagedPath = this.getStagedCookiesPath(profileId);
      if (fs.existsSync(stagedPath)) {
        cookies = JSON.parse(fs.readFileSync(stagedPath, 'utf8')) as CookieItem[];
      }
    }
    if (format === 'netscape') {
      return serializeCookiesNetscape(cookies);
    }
    return JSON.stringify(cookies, null, 2);
  }

  async warmup(profileId: string, config: WarmupConfig): Promise<WarmupResult> {
    const wasRunning = this.isRunning(profileId);
    if (!wasRunning) {
      await this.start(profileId);
    }
    const driver = this.runningDrivers.get(profileId);
    const inst = driver?.getInstance(profileId);
    if (!inst) {
      throw new Error(`Không thể khởi chạy warm-up cho hồ sơ: ${profileId}`);
    }
    this.logger.info('launcher', `Running warm-up for ${profileId} (${config.urls.length} URLs)`);
    try {
      return await inst.runWarmup(config);
    } finally {
      if (!wasRunning) {
        await this.stop(profileId);
      }
    }
  }
}
