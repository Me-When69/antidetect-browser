import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type ElectronApi } from '@shared/ipc';
import type {
  BrowserDownloadProgress,
  BrowserInstallProgressEvent,
  ProfileRunStatusEvent,
  ProxyCoreDownloadProgress,
} from '@shared/types';
import type { GmailBackupProgress } from '@shared/vaultTypes';
import type { Ipv6PoolConnectionStatsEvent } from '@shared/ipv6Types';

const electronApi: ElectronApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),

  listProfiles: (filter) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_LIST, filter),
  getProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_GET, id),
  createProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_CREATE, input),
  updateProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_UPDATE, input),
  deleteProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_DELETE, id),
  duplicateProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_DUPLICATE, id),
  bulkDeleteProfiles: (ids) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_BULK_DELETE, ids),
  bulkUpdateProfiles: (input) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_BULK_UPDATE, input),
  bulkCreateProfiles: (input) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_BULK_CREATE, input),
  listTrashProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_LIST_TRASH),
  restoreProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_RESTORE, id),
  permanentDeleteProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_PERMANENT_DELETE, id),
  emptyTrash: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_EMPTY_TRASH),
  importProfilesCsv: (rawCsv, folderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_IMPORT_CSV, rawCsv, folderId),
  cleanProfileCache: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROFILES_CLEAN_CACHE, id),

  listFolders: () => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_LIST),
  createFolder: (name) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_CREATE, name),
  deleteFolder: (id) => ipcRenderer.invoke(IPC_CHANNELS.FOLDERS_DELETE, id),
  listTags: () => ipcRenderer.invoke(IPC_CHANNELS.TAGS_LIST),
  createTag: (name, color) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_CREATE, name, color),
  deleteTag: (id) => ipcRenderer.invoke(IPC_CHANNELS.TAGS_DELETE, id),

  startProfile: (id, options) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_START, id, options),
  stopProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_STOP, id),
  bulkStartProfiles: (ids) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_BULK_START, ids),
  bulkStopProfiles: (ids) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_BULK_STOP, ids),
  getRunningProfileIds: () => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_RUNNING_IDS),
  warmupProfile: (profileId, config) =>
    ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_WARMUP, profileId, config),
  onProfileRunStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ProfileRunStatusEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.LAUNCHER_STATUS_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LAUNCHER_STATUS_EVENT, handler);
    };
  },

  listProxies: () => ipcRenderer.invoke(IPC_CHANNELS.PROXIES_LIST),
  createProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.PROXIES_CREATE, input),
  updateProxy: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.PROXIES_UPDATE, id, input),
  deleteProxy: (id) => ipcRenderer.invoke(IPC_CHANNELS.PROXIES_DELETE, id),
  checkProxy: (proxy) => ipcRenderer.invoke(IPC_CHANNELS.PROXIES_CHECK, proxy),
  checkProxyLeak: (proxy, expectedProxyIp, ipv6Policy) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROXIES_CHECK_LEAK, proxy, expectedProxyIp, ipv6Policy),

  generateFingerprint: (platform, browser) =>
    ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT_GENERATE, platform, browser),
  listDevicePresets: () => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT_PRESETS),

  importCookies: (profileId, rawText) =>
    ipcRenderer.invoke(IPC_CHANNELS.COOKIES_IMPORT, profileId, rawText),
  exportCookies: (profileId, format) =>
    ipcRenderer.invoke(IPC_CHANNELS.COOKIES_EXPORT, profileId, format),

  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, patch),
  regenerateApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_REGEN_API_KEY),
  getLocalApiStatus: () => ipcRenderer.invoke(IPC_CHANNELS.API_STATUS),

  exportBackup: (options) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_EXPORT, options),
  importBackup: (payload, password) =>
    ipcRenderer.invoke(IPC_CHANNELS.BACKUP_IMPORT, payload, password),
  exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_EXPORT),

  checkBrowserExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CHECK),
  listInstalledBrowsers: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LIST_INSTALLED),
  installPlaywrightChromium: (browser) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSER_INSTALL_CHROMIUM, browser ?? 'chromium'),
  onBrowserInstallProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: BrowserInstallProgressEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.BROWSER_INSTALL_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_INSTALL_PROGRESS, handler);
    };
  },

  listProxyCores: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_CORES_LIST),
  downloadProxyCore: (core) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_CORES_DOWNLOAD, core),
  onProxyCoreDownloadProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: ProxyCoreDownloadProgress): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.PROXY_CORES_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.PROXY_CORES_PROGRESS, handler);
    };
  },

  listEmulatedDevices: (platform) => ipcRenderer.invoke(IPC_CHANNELS.DEVICES_LIST, platform),
  pickRandomDevice: (platform, seed) =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICES_PICK_RANDOM, platform, seed),
  applyEmulatedDevice: (baseProfile, deviceId, realBrowserVersion) =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICES_APPLY, baseProfile, deviceId, realBrowserVersion),
  getEmulationConfidence: (targetPlatform, browser) =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICES_CONFIDENCE, targetPlatform, browser),

  listManagedBrowsers: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSERS_LIST_MANAGED),
  fetchAvailableChromeVersions: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSERS_FETCH_AVAILABLE),
  downloadChromeVersion: (version) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSERS_DOWNLOAD_VERSION, version),
  cancelChromeDownload: (version) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSERS_CANCEL_DOWNLOAD, version),
  deleteChromeVersion: (version) =>
    ipcRenderer.invoke(IPC_CHANNELS.BROWSERS_DELETE_VERSION, version),
  onBrowserDownloadProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: BrowserDownloadProgress): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.BROWSERS_DOWNLOAD_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.BROWSERS_DOWNLOAD_PROGRESS, handler);
    };
  },
  previewBulkVersionUpdate: (profileIds, targetVersion) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_PREVIEW_BULK_VERSION, profileIds, targetVersion),

  listPresets: () => ipcRenderer.invoke(IPC_CHANNELS.PRESETS_LIST),
  saveCustomPreset: (input) => ipcRenderer.invoke(IPC_CHANNELS.PRESETS_SAVE, input),
  deleteCustomPreset: (id) => ipcRenderer.invoke(IPC_CHANNELS.PRESETS_DELETE, id),

  // Vault & Gmail Accounts
  getVaultStatus: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_STATUS),
  unlockVault: (masterPassword) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_UNLOCK, masterPassword),
  lockVault: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_LOCK),
  onVaultLocked: (listener) => {
    const handler = (): void => {
      listener();
    };
    ipcRenderer.on(IPC_CHANNELS.VAULT_LOCKED_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.VAULT_LOCKED_EVENT, handler);
    };
  },
  changeVaultMasterPassword: (oldPassword, newPassword) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_CHANGE_MASTER_PASSWORD, oldPassword, newPassword),
  setVaultSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_SET_SETTINGS, settings),
  listVaultAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_LIST_ACCOUNTS),
  addVaultAccount: (input) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_ADD_ACCOUNT, input),
  updateVaultAccount: (input) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_UPDATE_ACCOUNT, input),
  deleteVaultAccount: (email) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_DELETE_ACCOUNT, email),
  markAccountPasswordChanged: (email) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_MARK_PASSWORD_CHANGED, email),
  generateStrongPassword: (length) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_GENERATE_PASSWORD, length),
  copyAccountPassword: (email) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_COPY_PASSWORD, email),
  revealAccountPasswordTemp: (email, masterPassword) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_REVEAL_PASSWORD_TEMP, email, masterPassword),
  getAccountNonCredDetails: (email) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_ACCOUNT_NON_CRED_DETAILS, email),
  getAccountTotpCode: (email) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_TOTP_CODE, email),
  copyAccountTotp: (email) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_COPY_TOTP, email),
  auditVaultSecurity: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_AUDIT_SECURITY),
  importGoogleCredentialsFile: () =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_IMPORT_GOOGLE_CREDENTIALS),
  importLegacyVaultDb: (legacyPassword, duplicateMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_IMPORT_LEGACY_DB, legacyPassword, duplicateMode),

  authorizeGmailAccount: (email, allowModify) =>
    ipcRenderer.invoke(IPC_CHANNELS.GMAIL_AUTHORIZE, email, allowModify),
  revokeGmailAccount: (email) => ipcRenderer.invoke(IPC_CHANNELS.GMAIL_REVOKE, email),
  searchGmailMessages: (emails, query, maxPerAccount) =>
    ipcRenderer.invoke(IPC_CHANNELS.GMAIL_SEARCH_MESSAGES, emails, query, maxPerAccount),
  cancelGmailSearch: () => ipcRenderer.invoke(IPC_CHANNELS.GMAIL_CANCEL_SEARCH),
  batchModifyGmailMessages: (email, ids, addLabelIds, removeLabelIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.GMAIL_BATCH_MODIFY, email, ids, addLabelIds, removeLabelIds),
  selectGmailBackupFolder: () => ipcRenderer.invoke(IPC_CHANNELS.GMAIL_SELECT_BACKUP_DIR),
  backupGmailEmails: (options) => ipcRenderer.invoke(IPC_CHANNELS.GMAIL_BACKUP_EMAILS, options),
  cancelGmailBackup: () => ipcRenderer.invoke(IPC_CHANNELS.GMAIL_CANCEL_BACKUP),
  onGmailBackupProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: GmailBackupProgress): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.GMAIL_BACKUP_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.GMAIL_BACKUP_PROGRESS, handler);
    };
  },
  selectGmailArchiveFile: () => ipcRenderer.invoke(IPC_CHANNELS.GMAIL_SELECT_ARCHIVE_FILE),
  extractGmailArchive: (archivePath, outputDir, password) =>
    ipcRenderer.invoke(IPC_CHANNELS.GMAIL_EXTRACT_ARCHIVE, archivePath, outputDir, password),

  linkAccountToProfile: (profileId, email) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_ACCOUNTS_LINK, profileId, email),
  unlinkAccountFromProfile: (profileId, email) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_ACCOUNTS_UNLINK, profileId, email),
  listLinkedAccountsForProfile: (profileId) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_ACCOUNTS_LIST_FOR_PROFILE, profileId),
  listAllProfileAccountLinks: () => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_ACCOUNTS_LIST_ALL),
  listProfilesForAccount: (email) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_ACCOUNTS_LIST_PROFILES_FOR_EMAIL, email),
  openGmailInProfile: (profileId, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_OPEN_GMAIL_IN_PROFILE, profileId, options),

  // Local IPv6 Pool
  listIpv6Interfaces: () => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_LIST_INTERFACES),
  getIpv6PoolStatus: () => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_GET_STATUS),
  updateIpv6PoolConfig: (patch) => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_UPDATE_CONFIG, patch),
  verifyIpv6PrefixRouting: () => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_VERIFY_ROUTING),
  allocateIpv6PoolAddresses: (count) => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_ALLOCATE, count),
  rotateProfileIpv6: (profileId, forceIfRunning) =>
    ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_ROTATE_PROFILE, profileId, forceIfRunning),
  rotateAllIpv6: (forceIfRunning) =>
    ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_ROTATE_ALL, forceIfRunning),
  removeIpv6PoolAddress: (address) =>
    ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_REMOVE_ADDRESS, address),
  removeAllIpv6PoolAddresses: () => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_REMOVE_ALL),
  checkIpv6PoolHealthAll: () => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_CHECK_HEALTH_ALL),
  detectIpv6PoolOrphans: () => ipcRenderer.invoke(IPC_CHANNELS.IPV6_POOL_DETECT_ORPHANS),
  onIpv6PoolStats: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: Ipv6PoolConnectionStatsEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.IPV6_POOL_STATS_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.IPV6_POOL_STATS_EVENT, handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
