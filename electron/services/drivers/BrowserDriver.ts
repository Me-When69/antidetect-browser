import type { CookieItem, Profile, WarmupConfig, WarmupResult } from '@shared/types';

export interface ResolvedGeo {
  timezone: string;
  language: string;
  acceptLanguage: string;
  lat: number | null;
  lon: number | null;
  accuracy?: number;
}

export interface DriverLaunchOptions {
  profile: Profile;
  userDataDir: string;
  proxyServerUrl: string | null;
  resolvedGeo: ResolvedGeo;
  customExecutablePath?: string;
  onUnexpectedClose: (profileId: string) => void;
}

export interface DriverInstance {
  profileId: string;
  wsEndpoint: string;
  close: () => Promise<void>;
  importCookies: (cookies: CookieItem[]) => Promise<number>;
  exportCookies: () => Promise<CookieItem[]>;
  runWarmup: (config: WarmupConfig) => Promise<WarmupResult>;
}

export interface BrowserDriver {
  readonly name: string;
  launch(options: DriverLaunchOptions): Promise<DriverInstance>;
  close(profileId: string): Promise<void>;
  isRunning(profileId: string): boolean;
  getInstance(profileId: string): DriverInstance | undefined;
}
