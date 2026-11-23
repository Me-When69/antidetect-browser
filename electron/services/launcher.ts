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
import {
  checkIdentityConsistency,
  parseCookiesText,
  serializeCookiesNetscape,
} from '@shared/validation';
import { buildAcceptLanguage, deriveGeo } from './geoService';
import { ensureBrowserInstalled } from './browserPath';
import {
  detectExecutableVersion,
  isVersionDowngrade,
  type BrowserManager,
} from './browserManager';
import { normalizeBrowserVersion } from './deviceCatalog';
import type { BrowserDriver, ResolvedGeo } from './drivers/BrowserDriver';
import { ChromeDriver } from './drivers/ChromeDriver';
import { CamoufoxDriver } from './drivers/CamoufoxDriver';
import type { ProfileService } from './profileService';
import type { ProxyService } from './proxyService';
import type { SettingsService } from './settingsService';
import type { AppLogger } from './logger';
import type { Ipv6PoolService } from './ipv6pool/ipv6PoolService';

type StatusListener = (event: ProfileRunStatusEvent) => void;

export const DEFAULT_MAX_CONCURRENT_PROFILES = 10;

export class ProfileLauncher {
  private profileService: ProfileService;
  private proxyService: ProxyService;
  private settingsService: SettingsService;
  private logger: AppLogger;
  private chromeDriver: BrowserDriver;
  private camoufoxDriver: BrowserDriver;
  private browserManager?: BrowserManager;
  private ipv6PoolService?: Ipv6PoolService;
  private maxConcurrentProfiles: number;
  private runningDrivers = new Map<string, BrowserDriver>();
  private startingProfiles = new Set<string>();
  private listeners = new Set<StatusListener>();

  constructor(
    profileService: ProfileService,
    proxyService: ProxyService,
    settingsService: SettingsService,
    logger: AppLogger,
    chromeDriver: BrowserDriver = new ChromeDriver(),
    camoufoxDriver: BrowserDriver = new CamoufoxDriver(),
    browserManager?: BrowserManager,
    ipv6PoolService?: Ipv6PoolService,
    maxConcurrentProfiles = DEFAULT_MAX_CONCURRENT_PROFILES,
  ) {
    this.profileService = profileService;
    this.proxyService = proxyService;
    this.settingsService = settingsService;
    this.logger = logger;
    this.chromeDriver = chromeDriver;
    this.camoufoxDriver = camoufoxDriver;
    this.browserManager = browserManager;
    this.ipv6PoolService = ipv6PoolService;
    this.maxConcurrentProfiles = Math.max(1, maxConcurrentProfiles);
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

    if (this.startingProfiles.has(profileId)) {
      return {
        profileId,
        running: false,
        wsEndpoint: '',
        error: 'Hồ sơ này đang trong quá trình khởi chạy, vui lòng đợi vài giây.',
      };
    }

    if (this.runningDrivers.size + this.startingProfiles.size >= this.maxConcurrentProfiles) {
      return {
        profileId,
        running: false,
        wsEndpoint: '',
        error: `Đã đạt giới hạn chạy đồng thời (${this.maxConcurrentProfiles} hồ sơ). Vui lòng dừng bớt hồ sơ đang chạy trước khi mở thêm.`,
      };
    }

    this.startingProfiles.add(profileId);
    try {
      return await this.startInternal(profile, options);
    } finally {
      this.startingProfiles.delete(profileId);
    }
  }

  private async startInternal(profile: Profile, options?: LaunchOptions): Promise<LaunchResult> {
    const profileId = profile.id;
    const driver = this.pickDriver(profile);
    const settings = this.settingsService.getSettings();
    const userDataDir = this.profileService.getProfileDir(profileId);

    this.logger.info(
      'launcher',
      `Starting profile ${profile.name} (${profileId}) via ${driver.name}`,
    );

    const targetBrowser = profile.browser === 'firefox' ? 'firefox' : 'chromium';
    const managedChromeExe =
      targetBrowser === 'chromium' && this.browserManager && profile.browserVersion
        ? this.browserManager.getExecutableForChromeVersion(profile.browserVersion)
        : null;

    const preferredCustomPath =
      targetBrowser === 'firefox'
        ? settings.camoufoxPath
        : managedChromeExe || settings.chromePath;

    const browserCheck = ensureBrowserInstalled(targetBrowser, {
      customPath: preferredCustomPath,
    });

    if (!browserCheck.installed) {
      this.logger.warn(
        'launcher',
        `Browser ${targetBrowser} not installed for profile ${profile.name} (expected=${browserCheck.expectedPath}): ${browserCheck.reason}`,
      );
      return {
        profileId,
        running: false,
        wsEndpoint: '',
        browserNotFound: true,
        errorCode: 'BROWSER_NOT_INSTALLED',
        missingBrowser: targetBrowser,
        error: browserCheck.reason,
      };
    }

    const detectedRealVersion = await detectExecutableVersion(browserCheck.executablePath);
    const effectiveVersion = detectedRealVersion
      ? normalizeBrowserVersion(detectedRealVersion)
      : normalizeBrowserVersion(profile.browserVersion);

    // Warn on browser downgrade to protect userDataDir from schema corruption
    if (
      profile.lastBrowserVersion &&
      isVersionDowngrade(profile.lastBrowserVersion, effectiveVersion) &&
      !options?.allowDowngrade
    ) {
      this.logger.warn(
        'launcher',
        `Blocked downgrade for ${profile.name}: ${profile.lastBrowserVersion} -> ${effectiveVersion}`,
      );
      return {
        profileId,
        running: false,
        wsEndpoint: '',
        downgradeDetected: true,
        errorCode: 'VERSION_DOWNGRADE',
        downgradeInfo: {
          lastVersion: profile.lastBrowserVersion,
          targetVersion: effectiveVersion,
        },
        error: `Hồ sơ "${profile.name}" từng chạy bằng phiên bản ${profile.lastBrowserVersion}, hạ xuống ${effectiveVersion} có thể làm hỏng dữ liệu trình duyệt (cookies/IndexedDB). Hãy nhân bản hồ sơ sang thư mục mới hoặc xác nhận tiếp tục.`,
      };
    }

    // Optional strict consistency check (blocks on critical mismatches)
    if (options?.strictVersionCheck) {
      const check = checkIdentityConsistency(profile, null, {
        realEngineVersion: effectiveVersion,
        browser: profile.browser,
      });
      const criticalErrors = check.warnings.filter((w) => w.severity === 'error');
      if (criticalErrors.length > 0) {
        return {
          profileId,
          running: false,
          wsEndpoint: '',
          errorCode: 'CONSISTENCY_ERROR',
          consistencyErrors: criticalErrors,
          error: criticalErrors[0]?.message ?? 'Hồ sơ có xung đột tính nhất quán.',
        };
      }
    }

    this.logger.info(
      'launcher',
      `Resolved browser for ${profile.name}: ${browserCheck.label} v${effectiveVersion} (${browserCheck.executablePath})`,
    );

    // Resolve local IPv6 Pool listener if profile uses 'ipv6pool'
    let effectiveProfile = profile;
    if (profile.proxy.type === 'ipv6pool') {
      if (!this.ipv6PoolService) {
        return {
          profileId,
          running: false,
          wsEndpoint: '',
          error: 'Dịch vụ Kho IPv6 cục bộ chưa được khởi tạo',
        };
      }
      const resolved = await this.ipv6PoolService.resolveProxyForProfile(profileId);
      effectiveProfile = {
        ...profile,
        proxy: resolved.proxy,
        ipv6Policy: 'proxy-only',
      };
    }

    const geoResolution = await this.resolveGeo(effectiveProfile, Boolean(options?.useFallbackGeo));
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

    // Enforce Design Principle 1: runtime UA & Client Hints version always equals real running engine version
    let launchProfile = {
      ...geoResolution.updatedProfile,
      proxy: effectiveProfile.proxy,
      ipv6Policy: effectiveProfile.ipv6Policy,
    };
    if (detectedRealVersion && launchProfile.platform !== 'ios') {
      const alignedVersion = normalizeBrowserVersion(detectedRealVersion);
      let alignedUa = launchProfile.userAgent;
      if (alignedUa !== 'auto') {
        if (launchProfile.browser === 'firefox') {
          const major = alignedVersion.split('.')[0] ?? '136';
          alignedUa = alignedUa
            .replace(/rv:\d+\.\d+/i, `rv:${major}.0`)
            .replace(/Firefox\/\d+\.\d+/i, `Firefox/${major}.0`);
        } else {
          alignedUa = alignedUa.replace(/Chrome\/\d+(?:\.\d+)*/i, `Chrome/${alignedVersion}`);
        }
      }
      launchProfile = {
        ...launchProfile,
        browserVersion: alignedVersion,
        userAgent: alignedUa,
      };
    }

    const proxyConn = await this.proxyService.openTunnelForProfile(
      profileId,
      effectiveProfile.proxy,
      effectiveProfile.browser,
    );

    try {
      const instance = await driver.launch({
        profile: launchProfile,
        userDataDir,
        proxyServerUrl: proxyConn?.server ?? null,
        proxyUsername: proxyConn?.username,
        proxyPassword: proxyConn?.password,
        resolvedGeo: geoResolution.geo,
        customExecutablePath: preferredCustomPath,
        onUnexpectedClose: (closedId) => {
          this.runningDrivers.delete(closedId);
          void this.proxyService.closeTunnelForProfile(closedId);
          this.logger.info('launcher', `Profile closed by user: ${closedId}`);
          this.emitStatus({ profileId: closedId, running: false });
        },
      });

      this.runningDrivers.set(profileId, driver);
      this.profileService.touchLastRun(profileId, effectiveVersion);

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

  async bulkStart(profileIds: string[], concurrency = 3): Promise<LaunchResult[]> {
    const results: LaunchResult[] = [];
    const batchSize = Math.max(1, Math.min(5, concurrency));
    for (let i = 0; i < profileIds.length; i += batchSize) {
      const batch = profileIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            return await this.start(id);
          } catch (err) {
            this.logger.warn(
              'launcher',
              `Bulk start skipped ${id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
          }
        }),
      );
      for (const r of batchResults) {
        if (r) results.push(r);
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

  /**
   * Launch (or reuse) a profile with full proxy/fingerprint/kill-switch isolation
   * and open Gmail (or a custom URL for tests). NEVER auto-fills credentials.
   */
  async openGmailInProfile(
    profileId: string,
    options?: LaunchOptions & { url?: string },
  ): Promise<LaunchResult> {
    const targetUrl = options?.url ?? 'https://mail.google.com';
    const launchRes = await this.start(profileId, options);
    if (!launchRes.running) {
      return launchRes;
    }
    const driver = this.runningDrivers.get(profileId);
    const inst = driver?.getInstance(profileId);
    if (inst?.openUrl) {
      await inst.openUrl(targetUrl);
    }
    return launchRes;
  }
}
