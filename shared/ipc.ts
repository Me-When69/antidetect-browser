import type {
  AppSettings,
  BackupPayload,
  BrowserCheckResult,
  BrowserDownloadProgress,
  BrowserInstallProgressEvent,
  BrowserInventoryItem,
  BrowserType,
  BulkCreateInput,
  BulkUpdateInput,
  BulkVersionPreviewItem,
  CookieItem,
  CreateProfileInput,
  CreateSavedProxyInput,
  DevicePreset,
  EmulatedDevice,
  EmulationConfidence,
  Folder,
  LaunchOptions,
  LaunchResult,
  LocalApiStatus,
  ManagedBrowserVersion,
  Platform,
  Profile,
  ProfileFilter,
  ProfileFingerprint,
  ProfilePreset,
  ProfileProxy,
  ProfileRunStatusEvent,
  ProxyCheckResult,
  ProxyCoreDownloadProgress,
  ProxyCoreInfo,
  ProxyLeakCheckResult,
  SavedProxy,
  Tag,
  UpdateProfileInput,
  WarmupConfig,
  WarmupResult,
} from './types';
import type {
  AccountSecurityIssue,
  GmailBackupOptions,
  GmailBackupProgress,
  GmailMessageSummary,
  LegacyImportResult,
  TotpCodeResult,
  VaultAccountCreateInput,
  VaultAccountSummary,
  VaultAccountUpdateInput,
  VaultStatus,
} from './vaultTypes';
import type {
  Ipv6PoolConfig,
  Ipv6PoolConnectionStatsEvent,
  Ipv6PoolEntrySummary,
  Ipv6PoolStatus,
  Ipv6RoutingCheckResult,
  NetworkInterfaceIpv6Info,
} from './ipv6Types';

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
  PROFILES_CLEAN_CACHE: 'profiles:cleanCache',

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

  BROWSER_CHECK: 'browser:check',
  BROWSER_LIST_INSTALLED: 'browser:listInstalled',
  BROWSER_INSTALL_CHROMIUM: 'browser:installChromium',
  BROWSER_INSTALL_PROGRESS: 'browser:installProgress',

  PROXY_CORES_LIST: 'proxyCores:list',
  PROXY_CORES_DOWNLOAD: 'proxyCores:download',
  PROXY_CORES_PROGRESS: 'proxyCores:progress',

  DEVICES_LIST: 'devices:list',
  DEVICES_PICK_RANDOM: 'devices:pickRandom',
  DEVICES_APPLY: 'devices:apply',
  DEVICES_CONFIDENCE: 'devices:confidence',

  BROWSERS_LIST_MANAGED: 'browsers:listManaged',
  BROWSERS_FETCH_AVAILABLE: 'browsers:fetchAvailable',
  BROWSERS_DOWNLOAD_VERSION: 'browsers:downloadVersion',
  BROWSERS_CANCEL_DOWNLOAD: 'browsers:cancelDownload',
  BROWSERS_DELETE_VERSION: 'browsers:deleteVersion',
  BROWSERS_DOWNLOAD_PROGRESS: 'browsers:downloadProgress',
  PROFILES_PREVIEW_BULK_VERSION: 'profiles:previewBulkVersion',

  PRESETS_LIST: 'presets:list',
  PRESETS_SAVE: 'presets:save',
  PRESETS_DELETE: 'presets:delete',

  // Vault & Gmail Accounts
  VAULT_STATUS: 'vault:status',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_LOCKED_EVENT: 'vault:lockedEvent',
  VAULT_CHANGE_MASTER_PASSWORD: 'vault:changeMasterPassword',
  VAULT_SET_SETTINGS: 'vault:setSettings',
  VAULT_LIST_ACCOUNTS: 'vault:listAccounts',
  VAULT_ADD_ACCOUNT: 'vault:addAccount',
  VAULT_UPDATE_ACCOUNT: 'vault:updateAccount',
  VAULT_DELETE_ACCOUNT: 'vault:deleteAccount',
  VAULT_MARK_PASSWORD_CHANGED: 'vault:markPasswordChanged',
  VAULT_GENERATE_PASSWORD: 'vault:generatePassword',
  VAULT_COPY_PASSWORD: 'vault:copyPassword',
  VAULT_REVEAL_PASSWORD_TEMP: 'vault:revealPasswordTemp',
  VAULT_GET_ACCOUNT_NON_CRED_DETAILS: 'vault:getAccountNonCredDetails',
  VAULT_GET_TOTP_CODE: 'vault:getTotpCode',
  VAULT_COPY_TOTP: 'vault:copyTotp',
  VAULT_AUDIT_SECURITY: 'vault:auditSecurity',
  VAULT_IMPORT_GOOGLE_CREDENTIALS: 'vault:importGoogleCredentials',
  VAULT_IMPORT_LEGACY_DB: 'vault:importLegacyDb',

  GMAIL_AUTHORIZE: 'gmail:authorize',
  GMAIL_SEARCH_MESSAGES: 'gmail:searchMessages',
  GMAIL_CANCEL_SEARCH: 'gmail:cancelSearch',
  GMAIL_BATCH_MODIFY: 'gmail:batchModify',
  GMAIL_SELECT_BACKUP_DIR: 'gmail:selectBackupDir',
  GMAIL_BACKUP_EMAILS: 'gmail:backupEmails',
  GMAIL_CANCEL_BACKUP: 'gmail:cancelBackup',
  GMAIL_BACKUP_PROGRESS: 'gmail:backupProgress',

  PROFILE_ACCOUNTS_LINK: 'profileAccounts:link',
  PROFILE_ACCOUNTS_UNLINK: 'profileAccounts:unlink',
  PROFILE_ACCOUNTS_LIST_FOR_PROFILE: 'profileAccounts:listForProfile',
  PROFILE_ACCOUNTS_LIST_ALL: 'profileAccounts:listAll',
  PROFILE_ACCOUNTS_LIST_PROFILES_FOR_EMAIL: 'profileAccounts:listProfilesForEmail',
  LAUNCHER_OPEN_GMAIL_IN_PROFILE: 'launcher:openGmailInProfile',

  // Local IPv6 Pool
  IPV6_POOL_LIST_INTERFACES: 'ipv6Pool:listInterfaces',
  IPV6_POOL_GET_STATUS: 'ipv6Pool:getStatus',
  IPV6_POOL_UPDATE_CONFIG: 'ipv6Pool:updateConfig',
  IPV6_POOL_VERIFY_ROUTING: 'ipv6Pool:verifyRouting',
  IPV6_POOL_ALLOCATE: 'ipv6Pool:allocate',
  IPV6_POOL_ROTATE_PROFILE: 'ipv6Pool:rotateProfile',
  IPV6_POOL_ROTATE_ALL: 'ipv6Pool:rotateAll',
  IPV6_POOL_REMOVE_ADDRESS: 'ipv6Pool:removeAddress',
  IPV6_POOL_REMOVE_ALL: 'ipv6Pool:removeAll',
  IPV6_POOL_CHECK_HEALTH_ALL: 'ipv6Pool:checkHealthAll',
  IPV6_POOL_DETECT_ORPHANS: 'ipv6Pool:detectOrphans',
  IPV6_POOL_STATS_EVENT: 'ipv6Pool:statsEvent',
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
  cleanProfileCache: (id: string) => Promise<{ freedBytes: number }>;

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

  // Browser Binary
  checkBrowserExecutable: () => Promise<BrowserCheckResult>;
  listInstalledBrowsers: () => Promise<BrowserInventoryItem[]>;
  installPlaywrightChromium: (
    browser?: 'chromium' | 'firefox',
  ) => Promise<{ ok: boolean; error?: string }>;
  onBrowserInstallProgress: (listener: (event: BrowserInstallProgressEvent) => void) => () => void;

  // Proxy External Cores (sing-box / xray)
  listProxyCores: () => Promise<ProxyCoreInfo[]>;
  downloadProxyCore: (core: 'sing-box' | 'xray') => Promise<{ ok: boolean; error?: string }>;
  onProxyCoreDownloadProgress: (listener: (event: ProxyCoreDownloadProgress) => void) => () => void;

  // Emulated Devices Catalog
  listEmulatedDevices: (platform?: Platform) => Promise<EmulatedDevice[]>;
  pickRandomDevice: (platform: Platform, seed?: number) => Promise<EmulatedDevice>;
  applyEmulatedDevice: (
    baseProfile: CreateProfileInput,
    deviceId: string,
    realBrowserVersion: string,
  ) => Promise<CreateProfileInput>;
  getEmulationConfidence: (
    targetPlatform: Platform,
    browser?: BrowserType,
  ) => Promise<EmulationConfidence>;

  // Multi-version Browser Manager
  listManagedBrowsers: () => Promise<ManagedBrowserVersion[]>;
  fetchAvailableChromeVersions: () => Promise<ManagedBrowserVersion[]>;
  downloadChromeVersion: (version: string) => Promise<{ ok: boolean; error?: string }>;
  cancelChromeDownload: (version: string) => Promise<boolean>;
  deleteChromeVersion: (version: string) => Promise<{ ok: boolean; error?: string }>;
  onBrowserDownloadProgress: (listener: (event: BrowserDownloadProgress) => void) => () => void;
  previewBulkVersionUpdate: (
    profileIds: string[],
    targetVersion: string,
  ) => Promise<BulkVersionPreviewItem[]>;

  // Advanced Profile Presets
  listPresets: () => Promise<ProfilePreset[]>;
  saveCustomPreset: (input: Omit<ProfilePreset, 'id' | 'builtIn'>) => Promise<ProfilePreset>;
  deleteCustomPreset: (id: string) => Promise<boolean>;

  // Vault & Gmail Accounts (Renderer NEVER receives plaintext passwords, TOTP secrets, or OAuth tokens)
  getVaultStatus: () => Promise<VaultStatus>;
  unlockVault: (masterPassword: string) => Promise<VaultStatus>;
  lockVault: () => Promise<VaultStatus>;
  onVaultLocked: (listener: () => void) => () => void;
  changeVaultMasterPassword: (oldPassword: string, newPassword: string) => Promise<void>;
  setVaultSettings: (settings: {
    autoLockMinutes?: number;
    lockOnMinimize?: boolean;
  }) => Promise<VaultStatus>;
  listVaultAccounts: () => Promise<VaultAccountSummary[]>;
  addVaultAccount: (input: VaultAccountCreateInput) => Promise<VaultAccountSummary>;
  updateVaultAccount: (input: VaultAccountUpdateInput) => Promise<VaultAccountSummary>;
  deleteVaultAccount: (email: string) => Promise<boolean>;
  markAccountPasswordChanged: (email: string) => Promise<number>;
  generateStrongPassword: (length?: number) => Promise<string>;
  copyAccountPassword: (email: string) => Promise<{ clearAfterSec: number }>;
  revealAccountPasswordTemp: (
    email: string,
    masterPassword: string,
  ) => Promise<{ password: string; ttlSeconds: number }>;
  getAccountNonCredDetails: (email: string) => Promise<{ recovery: string; notes: string }>;
  getAccountTotpCode: (email: string) => Promise<TotpCodeResult>;
  copyAccountTotp: (email: string) => Promise<TotpCodeResult & { clearAfterSec: number }>;
  auditVaultSecurity: () => Promise<AccountSecurityIssue[]>;
  importGoogleCredentialsFile: () => Promise<{ ok: boolean; cancelled?: boolean }>;
  importLegacyVaultDb: (
    legacyPassword: string,
    duplicateMode: 'skip' | 'overwrite',
  ) => Promise<LegacyImportResult & { cancelled?: boolean }>;

  // Gmail API
  authorizeGmailAccount: (email: string, allowModify: boolean) => Promise<{ scope: string }>;
  searchGmailMessages: (
    emails: string[],
    query: string,
    maxPerAccount?: number,
  ) => Promise<GmailMessageSummary[]>;
  cancelGmailSearch: () => Promise<void>;
  batchModifyGmailMessages: (
    email: string,
    ids: string[],
    addLabelIds: string[],
    removeLabelIds: string[],
  ) => Promise<{ modifiedCount: number }>;
  selectGmailBackupFolder: () => Promise<string | null>;
  backupGmailEmails: (options: GmailBackupOptions) => Promise<GmailBackupProgress>;
  cancelGmailBackup: () => Promise<void>;
  onGmailBackupProgress: (listener: (progress: GmailBackupProgress) => void) => () => void;

  // Profile <-> Account Links
  linkAccountToProfile: (profileId: string, email: string) => Promise<void>;
  unlinkAccountFromProfile: (profileId: string, email: string) => Promise<void>;
  listLinkedAccountsForProfile: (profileId: string) => Promise<string[]>;
  listAllProfileAccountLinks: () => Promise<Record<string, string[]>>;
  listProfilesForAccount: (email: string) => Promise<{ id: string; name: string }[]>;
  openGmailInProfile: (
    profileId: string,
    options?: LaunchOptions & { url?: string },
  ) => Promise<LaunchResult>;

  // Local IPv6 Pool (Renderer NEVER receives listener passwords)
  listIpv6Interfaces: () => Promise<NetworkInterfaceIpv6Info[]>;
  getIpv6PoolStatus: () => Promise<Ipv6PoolStatus>;
  updateIpv6PoolConfig: (patch: Partial<Ipv6PoolConfig>) => Promise<Ipv6PoolConfig>;
  verifyIpv6PrefixRouting: () => Promise<Ipv6RoutingCheckResult>;
  allocateIpv6PoolAddresses: (count: number) => Promise<Ipv6PoolEntrySummary[]>;
  rotateProfileIpv6: (
    profileId: string,
    forceIfRunning?: boolean,
  ) => Promise<{ oldAddress: string | null; newAddress: string }>;
  rotateAllIpv6: (forceIfRunning?: boolean) => Promise<{ rotated: number }>;
  removeIpv6PoolAddress: (address: string) => Promise<void>;
  removeAllIpv6PoolAddresses: () => Promise<{ removed: number }>;
  checkIpv6PoolHealthAll: () => Promise<Ipv6PoolEntrySummary[]>;
  detectIpv6PoolOrphans: () => Promise<string[]>;
  onIpv6PoolStats: (listener: (event: Ipv6PoolConnectionStatsEvent) => void) => () => void;
}

export type { CookieItem };
