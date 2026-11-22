import type {
  AppSettings,
  BackupPayload,
  BrowserType,
  BulkCreateInput,
  BulkUpdateInput,
  CookieItem,
  CreateProfileInput,
  CreateSavedProxyInput,
  DevicePreset,
  Folder,
  LaunchOptions,
  LaunchResult,
  LocalApiStatus,
  Platform,
  Profile,
  ProfileFilter,
  ProfileFingerprint,
  ProfileProxy,
  ProfileRunStatusEvent,
  ProxyCheckResult,
  ProxyLeakCheckResult,
  SavedProxy,
  Tag,
  UpdateProfileInput,
  WarmupConfig,
  WarmupResult,
} from './types';

export const IPC_CHANNELS = {
  APP_GET_INFO: 'app:getInfo',
  PROFILES_LIST: 'profiles:list',
  PROFILES_GET: 'profiles:get',
  PROFILES_CREATE: 'profiles:create',
  PROFILES_UPDATE: 'profiles:update',
  PROFILES_DELETE: 'profiles:delete',
  PROFILES_DUPLICATE: 'profiles:duplicate',
  PROFILES_BULK_DELETE: 'profiles:bulkDelete',
  PROFILES_BULK_UPDATE: 'profiles:bulkUpdate',
  PROFILES_BULK_CREATE: 'profiles:bulkCreate',
  PROFILES_LIST_TRASH: 'profiles:listTrash',
  PROFILES_RESTORE: 'profiles:restore',
  PROFILES_PERMANENT_DELETE: 'profiles:permanentDelete',
  PROFILES_EMPTY_TRASH: 'profiles:emptyTrash',
  PROFILES_IMPORT_CSV: 'profiles:importCsv',

  FOLDERS_LIST: 'folders:list',
  FOLDERS_CREATE: 'folders:create',
  FOLDERS_DELETE: 'folders:delete',

  TAGS_LIST: 'tags:list',
  TAGS_CREATE: 'tags:create',
  TAGS_DELETE: 'tags:delete',

  LAUNCHER_START: 'launcher:start',
  LAUNCHER_STOP: 'launcher:stop',
  LAUNCHER_BULK_START: 'launcher:bulkStart',
  LAUNCHER_BULK_STOP: 'launcher:bulkStop',
  LAUNCHER_RUNNING_IDS: 'launcher:runningIds',
  LAUNCHER_STATUS_EVENT: 'launcher:statusEvent',
  LAUNCHER_WARMUP: 'launcher:warmup',

  PROXIES_LIST: 'proxies:list',
  PROXIES_CREATE: 'proxies:create',
  PROXIES_UPDATE: 'proxies:update',
  PROXIES_DELETE: 'proxies:delete',
  PROXIES_CHECK: 'proxies:check',
  PROXIES_CHECK_LEAK: 'proxies:checkLeak',

  FINGERPRINT_GENERATE: 'fingerprint:generate',
  FINGERPRINT_PRESETS: 'fingerprint:presets',

  COOKIES_IMPORT: 'cookies:import',
  COOKIES_EXPORT: 'cookies:export',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_REGEN_API_KEY: 'settings:regenApiKey',
  API_STATUS: 'api:status',

  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',
  LOGS_EXPORT: 'logs:export',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  electronVersion: string;
  dataDir: string;
}

export interface GeneratedIdentity {
  platform: Platform;
  osVersion: string;
  browser: BrowserType;
  browserVersion: string;
  userAgent: string;
  fingerprint: ProfileFingerprint;
}

export interface ElectronApi {
  getAppInfo: () => Promise<AppInfo>;

  // Profiles
  listProfiles: (filter?: ProfileFilter) => Promise<Profile[]>;
  getProfile: (id: string) => Promise<Profile | null>;
  createProfile: (input: CreateProfileInput) => Promise<Profile>;
  updateProfile: (input: UpdateProfileInput) => Promise<Profile>;
  deleteProfile: (id: string) => Promise<void>;
  duplicateProfile: (id: string) => Promise<Profile>;
  bulkDeleteProfiles: (ids: string[]) => Promise<number>;
  bulkUpdateProfiles: (input: BulkUpdateInput) => Promise<number>;
  bulkCreateProfiles: (input: BulkCreateInput) => Promise<Profile[]>;
  listTrashProfiles: () => Promise<Profile[]>;
  restoreProfile: (id: string) => Promise<void>;
  permanentDeleteProfile: (id: string) => Promise<void>;
  emptyTrash: () => Promise<number>;
  importProfilesCsv: (rawCsv: string, folderId?: string | null) => Promise<Profile[]>;

  // Folders & Tags
  listFolders: () => Promise<Folder[]>;
  createFolder: (name: string) => Promise<Folder>;
  deleteFolder: (id: string) => Promise<void>;
  listTags: () => Promise<Tag[]>;
  createTag: (name: string, color?: string) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;

  // Launcher
  startProfile: (id: string, options?: LaunchOptions) => Promise<LaunchResult>;
  stopProfile: (id: string) => Promise<void>;
  bulkStartProfiles: (ids: string[]) => Promise<LaunchResult[]>;
  bulkStopProfiles: (ids: string[]) => Promise<void>;
  getRunningProfileIds: () => Promise<string[]>;
  onProfileRunStatus: (listener: (event: ProfileRunStatusEvent) => void) => () => void;
  warmupProfile: (profileId: string, config: WarmupConfig) => Promise<WarmupResult>;

  // Proxies
  listProxies: () => Promise<SavedProxy[]>;
  createProxy: (input: CreateSavedProxyInput) => Promise<SavedProxy>;
  updateProxy: (id: string, input: Partial<CreateSavedProxyInput>) => Promise<SavedProxy>;
  deleteProxy: (id: string) => Promise<void>;
  checkProxy: (proxy: ProfileProxy) => Promise<ProxyCheckResult>;
  checkProxyLeak: (
    proxy: ProfileProxy,
    expectedProxyIp?: string,
    ipv6Policy?: 'block' | 'proxy-only',
  ) => Promise<ProxyLeakCheckResult>;

  // Fingerprint
  generateFingerprint: (platform: Platform, browser: BrowserType) => Promise<GeneratedIdentity>;
  listDevicePresets: () => Promise<DevicePreset[]>;

  // Cookies
  importCookies: (profileId: string, rawText: string) => Promise<number>;
  exportCookies: (profileId: string, format: 'json' | 'netscape') => Promise<string>;

  // Settings & Local API
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  regenerateApiKey: () => Promise<string>;
  getLocalApiStatus: () => Promise<LocalApiStatus>;

  // Backup & Logs
  exportBackup: () => Promise<BackupPayload>;
  importBackup: (
    payload: BackupPayload,
  ) => Promise<{ profiles: number; folders: number; proxies: number }>;
  exportLogs: () => Promise<string>;
}

export type { CookieItem };
