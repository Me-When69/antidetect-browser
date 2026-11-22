export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';
export type BrowserType = 'chrome' | 'firefox' | 'webkit';
export type ProxyType =
  | 'none'
  | 'http'
  | 'https'
  | 'socks4'
  | 'socks4a'
  | 'socks5'
  | 'socks5h'
  | 'ssh'
  | 'shadowsocks'
  | 'vmess'
  | 'vless'
  | 'trojan';
export type GeoMode = 'auto' | 'manual';
export type WebRtcMode = 'replace' | 'disable' | 'real';
export type Ipv6Policy = 'block' | 'proxy-only';
export type ProfileStatus = 'none' | 'active' | 'banned' | 'warming' | 'ready';

export interface ProfileProxy {
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey?: string;
  extra?: Record<string, string>;
  chain?: ProfileProxy[];
}

export type ProxyConfig = ProfileProxy;

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
  mobile?: boolean;
  maxTouchPoints?: number;
  model?: string;
  architecture?: string;
  bitness?: string;
  platformVersion?: string;
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
  deviceId?: string | null;
  deviceLabel?: string;
  browser: BrowserType;
  browserVersion: string;
  lastBrowserVersion?: string | null;
  userAgent: string;
  proxy: ProfileProxy;
  ipv6Policy: Ipv6Policy;
  geo: ProfileGeo;
  fingerprint: ProfileFingerprint;
  startup: ProfileStartup;
  createdAt: string;
  lastRunAt: string | null;
  deletedAt: string | null;
}

export interface EmulatedDevice {
  id: string;
  label: string;
  platform: Platform;
  osVersion: string;
  mobile: boolean;
  model?: string;
  brand?: string;
  weight?: number;
  screen: ProfileScreen;
  viewport: { width: number; height: number };
  hardware: ProfileHardware;
  gpu: ProfileWebGL;
  touch: { maxTouchPoints: number };
  fonts: string[];
  uaTemplate: string;
  clientHints: {
    platform: string;
    platformVersion: string;
    architecture: string;
    bitness: string;
    model: string;
    mobile: boolean;
  } | null;
  languagesHint?: string[];
  notes?: string;
}

export interface ManagedBrowserVersion {
  id: string;
  browserKind: BrowserType;
  channel: 'stable' | 'beta' | 'archive' | 'system' | 'playwright' | 'camoufox';
  version: string;
  major: number;
  installed: boolean;
  executablePath: string;
  sizeBytes: number;
  profileCount: number;
}

export interface BrowserDownloadProgress {
  version: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  done?: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface BulkVersionPreviewItem {
  profileId: string;
  profileName: string;
  currentVersion: string;
  targetVersion: string;
  action: 'upgrade' | 'same' | 'downgrade';
}

export type CreateProfileInput = Omit<Profile, 'id' | 'createdAt' | 'lastRunAt' | 'deletedAt'>;
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
  ipVersion?: 4 | 6;
  protocolUsed?: ProxyType;
  viaBridge?: boolean;
  dnsLeakRisk?: boolean;
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

export interface ProxyCoreInfo {
  name: 'sing-box' | 'xray';
  installed: boolean;
  version: string;
  executablePath: string;
}

export interface ProxyCoreDownloadProgress {
  core: 'sing-box' | 'xray';
  percent: number | null;
  line: string;
  done?: boolean;
  success?: boolean;
  error?: string;
}

export interface ProxyLeakCheckResult {
  ok: boolean;
  ipv4: string;
  ipv6: string;
  leaked: boolean;
  warning?: string;
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
  browserVersion?: string;
  deviceId?: string;
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

export interface LaunchOptions {
  useFallbackGeo?: boolean;
}

export interface LaunchResult {
  profileId: string;
  running: boolean;
  wsEndpoint: string;
  proxyCheckFailed?: boolean;
  browserNotFound?: boolean;
  errorCode?: 'BROWSER_NOT_INSTALLED' | 'PROXY_CHECK_FAILED';
  missingBrowser?: 'chromium' | 'firefox';
  error?: string;
}

export interface BrowserCheckResult {
  found: boolean;
  label?: string;
  executablePath?: string;
  error?: string;
}

export interface BrowserInventoryItem {
  id: 'system-chrome' | 'playwright-chromium' | 'playwright-firefox';
  name: string;
  installed: boolean;
  executablePath: string;
  version: string;
  installableTarget?: 'chromium' | 'firefox';
}

export interface BrowserInstallProgressEvent {
  browser: 'chromium' | 'firefox';
  percent: number | null;
  line: string;
  done?: boolean;
  success?: boolean;
  error?: string;
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
export type ThemeMode = 'dark' | 'light';

export interface AppSettings {
  locale: LocaleCode;
  theme: ThemeMode;
  chromePath: string;
  camoufoxPath: string;
  localApiEnabled: boolean;
  localApiPort: number;
  localApiKey: string;
}

export interface WarmupConfig {
  urls: string[];
  minStaySec: number;
  maxStaySec: number;
  scroll: boolean;
}

export interface WarmupResult {
  profileId: string;
  visited: number;
  failed: number;
}

export interface CsvProfileRow {
  name: string;
  proxyRaw: string;
  tags: string[];
  notes: string;
  platform: Platform;
  browser: BrowserType;
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
