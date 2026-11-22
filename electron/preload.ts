import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, type ElectronApi } from '@shared/ipc';
import type { BrowserInstallProgressEvent, ProfileRunStatusEvent } from '@shared/types';

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

  exportBackup: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_EXPORT),
  importBackup: (payload) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_IMPORT, payload),
  exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_EXPORT),

  checkBrowserExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CHECK),
  installPlaywrightChromium: () => ipcRenderer.invoke(IPC_CHANNELS.BROWSER_INSTALL_CHROMIUM),
  onBrowserInstallProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: BrowserInstallProgressEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.BROWSER_INSTALL_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.BROWSER_INSTALL_PROGRESS, handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
