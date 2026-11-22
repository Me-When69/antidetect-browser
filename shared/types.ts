export type Platform = 'windows' | 'macos' | 'linux';
export type BrowserType = 'chrome' | 'firefox';
export type ProxyType = 'none' | 'http' | 'https' | 'socks5';
export type GeoMode = 'auto' | 'manual';
export type WebRtcMode = 'replace' | 'disable' | 'real';
export type ProfileStatus = 'none' | 'active' | 'banned' | 'warming' | 'ready';

export interface ProfileProxy {
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProfileGeo {
  mode: GeoMode;
  timezone: string;
  language: string;
  lat: number | null;
  lon: number | null;
}

export interface ProfileScreen {
  width: number;
  height: number;
  dpr: number;
}

export interface ProfileHardware {
  cores: number;
  memory: number;
}

export interface ProfileWebGL {
  vendor: string;
  renderer: string;
}

export interface ProfileFingerprint {
  screen: ProfileScreen;
  hardware: ProfileHardware;
  webgl: ProfileWebGL;
  canvasNoiseSeed: number;
  audioNoiseSeed: number;
  fonts: string[];
  webrtc: WebRtcMode;
}

export interface ProfileStartup {
  urls: string[];
  restoreTabs: boolean;
}

export interface Profile {
  id: string;
  name: string;
  folderId: string | null;
  status: ProfileStatus;
  tags: string[];
  notes: string;
  platform: Platform;
  osVersion: string;
  browser: BrowserType;
  browserVersion: string;
  userAgent: string;
  proxy: ProfileProxy;
  geo: ProfileGeo;
  fingerprint: ProfileFingerprint;
  startup: ProfileStartup;
  createdAt: string;
  lastRunAt: string | null;
}

export type CreateProfileInput = Omit<Profile, 'id' | 'createdAt' | 'lastRunAt'>;
export type UpdateProfileInput = Partial<CreateProfileInput> & { id: string };

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface SavedProxy {
  id: string;
  name: string;
  type: Exclude<ProxyType, 'none'>;
  host: string;
  port: number;
  username: string;
  password: string;
  country: string;
  createdAt: string;
}

export type CreateSavedProxyInput = Omit<SavedProxy, 'id' | 'createdAt'>;

export interface ProxyCheckResult {
  ok: boolean;
  ip: string;
  country: string;
  countryCode: string;
  city: string;
  timezone: string;
  lat: number | null;
  lon: number | null;
  language: string;
  latencyMs: number;
  error?: string;
}

export interface ProfileFilter {
  search?: string;
  folderId?: string | null;
  tag?: string;
  status?: ProfileStatus | 'all';
  sortBy?: 'name' | 'createdAt' | 'lastRunAt';
  sortDir?: 'asc' | 'desc';
}

export interface BulkCreateInput {
  baseName: string;
  count: number;
  template: CreateProfileInput;
  proxyList: string[];
}

export interface BulkUpdateInput {
  ids: string[];
  folderId?: string | null;
  addTags?: string[];
  status?: ProfileStatus;
  proxy?: ProfileProxy;
}

export interface DevicePreset {
  id: string;
  label: string;
  platform: Platform;
  osVersion: string;
  browser: BrowserType;
  browserVersion: string;
  userAgent: string;
  screen: ProfileScreen;
  hardware: ProfileHardware;
  webgl: ProfileWebGL;
  fonts: string[];
}

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface IdentityCheckWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  suggestion: string;
}

export interface IdentityCheckResult {
  score: number;
  ok: boolean;
  warnings: IdentityCheckWarning[];
}

export interface ProfileRunStatusEvent {
  profileId: string;
  running: boolean;
  wsEndpoint?: string;
  error?: string;
}

export interface LaunchResult {
  profileId: string;
  running: boolean;
  wsEndpoint: string;
}

export interface CookieItem {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export type LocaleCode = 'vi' | 'en';

export interface AppSettings {
  locale: LocaleCode;
  chromePath: string;
  camoufoxPath: string;
  localApiEnabled: boolean;
  localApiPort: number;
  localApiKey: string;
}

export interface LocalApiStatus {
  running: boolean;
  port: number;
  baseUrl: string;
}

export interface BackupPayload {
  version: number;
  exportedAt: string;
  folders: Folder[];
  tags: Tag[];
  proxies: SavedProxy[];
  profiles: Profile[];
}
