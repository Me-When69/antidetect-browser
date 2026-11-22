import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';

// Set PLAYWRIGHT_BROWSERS_PATH once at startup (outside app.asar) before Playwright initializes
if (!process.env['PLAYWRIGHT_BROWSERS_PATH']) {
  process.env['PLAYWRIGHT_BROWSERS_PATH'] = path.join(app.getPath('userData'), 'browsers');
}

// Disable unused Electron Chromium features to save RAM & startup time
app.commandLine.appendSwitch('disable-features', 'SpellCheck,MediaRouter,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-networking');

import { IPC_CHANNELS, type AppInfo } from '@shared/ipc';
import type {
  AppSettings,
  BackupPayload,
  BrowserCheckResult,
  BrowserInstallProgressEvent,
  BrowserType,
  BulkCreateInput,
  BulkUpdateInput,
  CreateProfileInput,
  CreateSavedProxyInput,
  Ipv6Policy,
  LaunchOptions,
  Platform,
  ProfileFilter,
  ProfilePreset,
  ProfileProxy,
  UpdateProfileInput,
  WarmupConfig,
} from '@shared/types';
import { createDatabase, type DbContext } from './db';
import { SecretService } from './services/secretService';
import { AppLogger } from './services/logger';
import { ProfileService } from './services/profileService';
import { PresetService } from './services/presetService';
import { ProxyService } from './services/proxyService';
import { SettingsService } from './services/settingsService';
import { ProfileLauncher } from './services/launcher';
import { LocalApiServer } from './services/localApi';
import { listInstalledBrowsers, resolveBrowserExecutable } from './services/browserPath';
import { BrowserInstaller } from './services/browserInstaller';
import { BrowserManager, previewBulkVersionUpdate } from './services/browserManager';
import {
  applyDevice,
  getDeviceById,
  getEmulationConfidence,
  listDevices,
  pickWeightedDevice,
} from './services/deviceCatalog';
import { ProxyCoreManager } from './services/proxyCoreManager';
import { ProxyBridgeManager } from './services/proxyBridge';
import { generateConsistentIdentity, listDevicePresets } from './services/fingerprint/generator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, '..');

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let mainWindow: BrowserWindow | null = null;
let dbCtx: DbContext | null = null;
let launcher: ProfileLauncher | null = null;
let localApi: LocalApiServer | null = null;

function resolveDataDir(): string {
  if (process.env['ANTIDETECT_DATA_DIR']) {
    return process.env['ANTIDETECT_DATA_DIR'];
  }
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(process.env.APP_ROOT!, 'data');
}

function initServices(): {
  dataDir: string;
  logger: AppLogger;
  coreManager: ProxyCoreManager;
  browserManager: BrowserManager;
  profileService: ProfileService;
  proxyService: ProxyService;
  settingsService: SettingsService;
  profileLauncher: ProfileLauncher;
  apiServer: LocalApiServer;
} {
  // Ensure Playwright never looks inside app.asar when packaged by electron-builder
  if (!process.env['PLAYWRIGHT_BROWSERS_PATH']) {
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = path.join(app.getPath('userData'), 'browsers');
  }

  const dataDir = resolveDataDir();
  const dbPath = path.join(dataDir, 'antidetect.db');
  const profilesDir = path.join(dataDir, 'profiles');
  const logsDir = path.join(dataDir, 'logs');

  dbCtx = createDatabase(dbPath);
  const secrets = new SecretService(safeStorage);
  const logger = new AppLogger(logsDir);
  const coreManager = new ProxyCoreManager(path.join(app.getPath('userData'), 'cores'), logger);
  let profileLauncherRef: ProfileLauncher | null = null;
  const bridgeManager = new ProxyBridgeManager(
    logger,
    coreManager,
    path.join(app.getPath('userData'), 'bridge-pids.json'),
    (profileId, reason) => {
      if (profileLauncherRef) {
        void profileLauncherRef.stop(profileId);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.LAUNCHER_STATUS_EVENT, {
          profileId,
          running: false,
          error: reason,
        });
      }
    },
  );
  // Defer non-critical orphan process scan until after window is created
  setImmediate(() => {
    bridgeManager.cleanupOrphanProcesses();
  });

  const profileService = new ProfileService(dbCtx.db, secrets, profilesDir);
  const proxyService = new ProxyService(dbCtx.db, secrets, undefined, bridgeManager);
  const settingsService = new SettingsService(dbCtx.db);
  const browserManager = new BrowserManager(path.join(app.getPath('userData'), 'browsers'), logger);
  const profileLauncher = new ProfileLauncher(
    profileService,
    proxyService,
    settingsService,
    logger,
    undefined,
    undefined,
    browserManager,
  );
  profileLauncherRef = profileLauncher;
  const apiServer = new LocalApiServer(profileService, profileLauncher, settingsService, logger);

  launcher = profileLauncher;
  localApi = apiServer;

  profileLauncher.onStatusChange((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.LAUNCHER_STATUS_EVENT, event);
    }
  });

  const settings = settingsService.getSettings();
  if (settings.localApiEnabled) {
    setImmediate(() => {
      void apiServer.start(settings.localApiPort).catch((err) => {
        logger.error('main', `Could not start Local API: ${String(err)}`);
      });
    });
  }

  logger.info('main', `Initialized services (dataDir=${dataDir})`);

  return {
    dataDir,
    logger,
    coreManager,
    browserManager,
    profileService,
    proxyService,
    settingsService,
    profileLauncher,
    apiServer,
  };
}

function registerIpcHandlers(): void {
  const {
    dataDir,
    logger,
    coreManager,
    browserManager,
    profileService,
    proxyService,
    settingsService,
    profileLauncher,
    apiServer,
  } = initServices();

  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    dataDir,
  }));

  // Profiles
  ipcMain.handle(IPC_CHANNELS.PROFILES_LIST, (_e, filter?: ProfileFilter) =>
    profileService.list(filter),
  );
  ipcMain.handle(IPC_CHANNELS.PROFILES_GET, (_e, id: string) => profileService.getById(id));
  ipcMain.handle(IPC_CHANNELS.PROFILES_CREATE, (_e, input: CreateProfileInput) =>
    profileService.create(input),
  );
  ipcMain.handle(IPC_CHANNELS.PROFILES_UPDATE, (_e, input: UpdateProfileInput) =>
    profileService.update(input),
  );
  ipcMain.handle(IPC_CHANNELS.PROFILES_DELETE, async (_e, id: string) => {
    await profileLauncher.stop(id);
    profileService.delete(id);
  });
  ipcMain.handle(IPC_CHANNELS.PROFILES_DUPLICATE, (_e, id: string) => profileService.duplicate(id));
  ipcMain.handle(IPC_CHANNELS.PROFILES_BULK_DELETE, async (_e, ids: string[]) => {
    await profileLauncher.bulkStop(ids);
    return profileService.bulkDelete(ids);
  });
  ipcMain.handle(IPC_CHANNELS.PROFILES_BULK_UPDATE, (_e, input: BulkUpdateInput) =>
    profileService.bulkUpdate(input),
  );
  ipcMain.handle(IPC_CHANNELS.PROFILES_BULK_CREATE, (_e, input: BulkCreateInput) =>
    profileService.bulkCreate(input),
  );
  ipcMain.handle(IPC_CHANNELS.PROFILES_LIST_TRASH, () => profileService.listTrash());
  ipcMain.handle(IPC_CHANNELS.PROFILES_RESTORE, (_e, id: string) => profileService.restore(id));
  ipcMain.handle(IPC_CHANNELS.PROFILES_PERMANENT_DELETE, async (_e, id: string) => {
    await profileLauncher.stop(id);
    profileService.permanentDelete(id);
  });
  ipcMain.handle(IPC_CHANNELS.PROFILES_EMPTY_TRASH, () => profileService.emptyTrash());
  ipcMain.handle(IPC_CHANNELS.PROFILES_IMPORT_CSV, (_e, rawCsv: string, folderId?: string | null) =>
    profileService.importCsv(rawCsv, folderId ?? null),
  );

  // Folders & Tags
  ipcMain.handle(IPC_CHANNELS.FOLDERS_LIST, () => profileService.listFolders());
  ipcMain.handle(IPC_CHANNELS.FOLDERS_CREATE, (_e, name: string) =>
    profileService.createFolder(name),
  );
  ipcMain.handle(IPC_CHANNELS.FOLDERS_DELETE, (_e, id: string) => profileService.deleteFolder(id));
  ipcMain.handle(IPC_CHANNELS.TAGS_LIST, () => profileService.listTags());
  ipcMain.handle(IPC_CHANNELS.TAGS_CREATE, (_e, name: string, color?: string) =>
    profileService.createTag(name, color),
  );
  ipcMain.handle(IPC_CHANNELS.TAGS_DELETE, (_e, id: string) => profileService.deleteTag(id));

  // Launcher
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_START, (_e, id: string, options?: LaunchOptions) =>
    profileLauncher.start(id, options),
  );
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_STOP, (_e, id: string) => profileLauncher.stop(id));
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_BULK_START, (_e, ids: string[]) =>
    profileLauncher.bulkStart(ids),
  );
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_BULK_STOP, (_e, ids: string[]) =>
    profileLauncher.bulkStop(ids),
  );
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_RUNNING_IDS, () => profileLauncher.getRunningIds());
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_WARMUP, (_e, profileId: string, config: WarmupConfig) =>
    profileLauncher.warmup(profileId, config),
  );

  // Proxies
  ipcMain.handle(IPC_CHANNELS.PROXIES_LIST, () => proxyService.list());
  ipcMain.handle(IPC_CHANNELS.PROXIES_CREATE, (_e, input: CreateSavedProxyInput) =>
    proxyService.create(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROXIES_UPDATE,
    (_e, id: string, input: Partial<CreateSavedProxyInput>) => proxyService.update(id, input),
  );
  ipcMain.handle(IPC_CHANNELS.PROXIES_DELETE, (_e, id: string) => proxyService.delete(id));
  ipcMain.handle(IPC_CHANNELS.PROXIES_CHECK, (_e, proxy: ProfileProxy) =>
    proxyService.checkProxy(proxy),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROXIES_CHECK_LEAK,
    (_e, proxy: ProfileProxy, expectedProxyIp?: string, ipv6Policy?: Ipv6Policy) =>
      proxyService.checkProxyLeak(proxy, expectedProxyIp, ipv6Policy ?? 'block'),
  );

  // Fingerprint
  ipcMain.handle(
    IPC_CHANNELS.FINGERPRINT_GENERATE,
    (_e, platform: Platform, browser: BrowserType) => generateConsistentIdentity(platform, browser),
  );
  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_PRESETS, () => listDevicePresets());

  // Cookies
  ipcMain.handle(IPC_CHANNELS.COOKIES_IMPORT, (_e, profileId: string, rawText: string) =>
    profileLauncher.importCookies(profileId, rawText),
  );
  ipcMain.handle(
    IPC_CHANNELS.COOKIES_EXPORT,
    (_e, profileId: string, format: 'json' | 'netscape') =>
      profileLauncher.exportCookies(profileId, format),
  );

  // Settings & Local API
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settingsService.getSettings());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_e, patch: Partial<AppSettings>) => {
    const updated = settingsService.updateSettings(patch);
    if (patch.localApiEnabled !== undefined || patch.localApiPort !== undefined) {
      if (updated.localApiEnabled) {
        await apiServer.start(updated.localApiPort).catch((err) => {
          logger.error('main', `Failed to restart Local API: ${String(err)}`);
        });
      } else {
        await apiServer.stop();
      }
    }
    return updated;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS_REGEN_API_KEY, () => settingsService.regenerateApiKey());
  ipcMain.handle(IPC_CHANNELS.API_STATUS, () => apiServer.getStatus());

  // Backup & Logs
  ipcMain.handle(IPC_CHANNELS.BACKUP_EXPORT, () => profileService.exportBackup());
  ipcMain.handle(IPC_CHANNELS.BACKUP_IMPORT, (_e, payload: BackupPayload) =>
    profileService.importBackup(payload),
  );
  ipcMain.handle(IPC_CHANNELS.LOGS_EXPORT, () => logger.exportLogs());

  // Browser executable detection & on-demand Playwright Chromium install
  ipcMain.handle(IPC_CHANNELS.BROWSER_CHECK, (): BrowserCheckResult => {
    try {
      const settings = settingsService.getSettings();
      const resolved = resolveBrowserExecutable({ customPath: settings.chromePath });
      logger.info('browser', `Detected browser: ${resolved.label} (${resolved.executablePath})`);
      return {
        found: true,
        label: resolved.label,
        executablePath: resolved.executablePath,
      };
    } catch (err) {
      return {
        found: false,
        error:
          err instanceof Error
            ? err.message
            : "Không tìm thấy Chrome. Hãy cài Google Chrome hoặc bấm 'Tải Chromium'",
      };
    }
  });

  const browserInstaller = new BrowserInstaller(
    process.env.APP_ROOT!,
    process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? path.join(app.getPath('userData'), 'browsers'),
    logger,
  );

  ipcMain.handle(IPC_CHANNELS.BROWSER_LIST_INSTALLED, () => {
    const settings = settingsService.getSettings();
    return listInstalledBrowsers(settings.chromePath, settings.camoufoxPath);
  });

  ipcMain.handle(
    IPC_CHANNELS.BROWSER_INSTALL_CHROMIUM,
    (_e, targetBrowser: 'chromium' | 'firefox' = 'chromium') => {
      return browserInstaller.install(targetBrowser, (payload: BrowserInstallProgressEvent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.BROWSER_INSTALL_PROGRESS, payload);
        }
      });
    },
  );

  // External proxy cores (sing-box / xray)
  ipcMain.handle(IPC_CHANNELS.PROXY_CORES_LIST, () => coreManager.listCores());
  ipcMain.handle(IPC_CHANNELS.PROXY_CORES_DOWNLOAD, (_e, core: 'sing-box' | 'xray') =>
    coreManager.downloadCore(core, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.PROXY_CORES_PROGRESS, payload);
      }
    }),
  );

  // Emulated devices catalog
  ipcMain.handle(IPC_CHANNELS.DEVICES_LIST, (_e, platform?: Platform) => listDevices(platform));
  ipcMain.handle(IPC_CHANNELS.DEVICES_PICK_RANDOM, (_e, platform: Platform, seed?: number) =>
    pickWeightedDevice(platform, seed),
  );
  ipcMain.handle(
    IPC_CHANNELS.DEVICES_APPLY,
    (_e, baseProfile: CreateProfileInput, deviceId: string, realBrowserVersion: string) => {
      const device = getDeviceById(deviceId);
      if (!device) {
        throw new Error(`Không tìm thấy thiết bị giả lập: ${deviceId}`);
      }
      return applyDevice(baseProfile, device, realBrowserVersion);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.DEVICES_CONFIDENCE,
    (_e, targetPlatform: Platform, browser?: BrowserType) =>
      getEmulationConfidence(targetPlatform, process.platform, browser),
  );

  // Multi-version Browser Manager
  ipcMain.handle(IPC_CHANNELS.BROWSERS_LIST_MANAGED, () => {
    const settings = settingsService.getSettings();
    const profiles = profileService.list();
    return browserManager.listInstalledVersions(
      profiles,
      settings.chromePath,
      settings.camoufoxPath,
    );
  });
  ipcMain.handle(IPC_CHANNELS.BROWSERS_FETCH_AVAILABLE, () =>
    browserManager.fetchAvailableChromeVersions(),
  );
  ipcMain.handle(IPC_CHANNELS.BROWSERS_DOWNLOAD_VERSION, (_e, version: string) =>
    browserManager.downloadChromeVersion(version, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.BROWSERS_DOWNLOAD_PROGRESS, payload);
      }
    }),
  );
  ipcMain.handle(IPC_CHANNELS.BROWSERS_CANCEL_DOWNLOAD, (_e, version: string) =>
    browserManager.cancelDownload(version),
  );
  ipcMain.handle(IPC_CHANNELS.BROWSERS_DELETE_VERSION, (_e, version: string) =>
    browserManager.deleteChromeVersion(version),
  );
  ipcMain.handle(
    IPC_CHANNELS.PROFILES_PREVIEW_BULK_VERSION,
    (_e, profileIds: string[], targetVersion: string) => {
      const selected = profileIds
        .map((id) => profileService.getById(id))
        .filter((p): p is NonNullable<typeof p> => p !== null);
      return previewBulkVersionUpdate(selected, targetVersion);
    },
  );

  // Advanced Profile Presets
  const presetService = new PresetService(dbCtx!.db);
  ipcMain.handle(IPC_CHANNELS.PRESETS_LIST, () => presetService.listPresets());
  ipcMain.handle(
    IPC_CHANNELS.PRESETS_SAVE,
    (_e, input: Omit<ProfilePreset, 'id' | 'builtIn'>) => presetService.saveCustomPreset(input),
  );
  ipcMain.handle(IPC_CHANNELS.PRESETS_DELETE, (_e, id: string) =>
    presetService.deleteCustomPreset(id),
  );
}

function createWindow(): void {
  const iconPath = path.join(process.env.APP_ROOT!, 'build', 'icons', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0E1116',
    title: 'Facet',
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    mainWindow = null;
  }
});

app.on('before-quit', () => {
  if (launcher) {
    void launcher.stopAll();
  }
  if (localApi) {
    void localApi.stop();
  }
  if (dbCtx) {
    try {
      dbCtx.sqlite.close();
    } catch {
      // Ignore already closed
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

void app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});
