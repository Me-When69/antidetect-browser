import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { IPC_CHANNELS, type AppInfo } from '@shared/ipc';
import type {
  AppSettings,
  BackupPayload,
  BrowserType,
  BulkCreateInput,
  BulkUpdateInput,
  CreateProfileInput,
  CreateSavedProxyInput,
  Platform,
  ProfileFilter,
  ProfileProxy,
  UpdateProfileInput,
} from '@shared/types';
import { createDatabase, type DbContext } from './db';
import { SecretService } from './services/secretService';
import { AppLogger } from './services/logger';
import { ProfileService } from './services/profileService';
import { ProxyService } from './services/proxyService';
import { SettingsService } from './services/settingsService';
import { ProfileLauncher } from './services/launcher';
import { LocalApiServer } from './services/localApi';
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
  // Keep data/ inside project root during dev, or userData when packaged
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(process.env.APP_ROOT!, 'data');
}

function initServices(): {
  dataDir: string;
  logger: AppLogger;
  profileService: ProfileService;
  proxyService: ProxyService;
  settingsService: SettingsService;
  profileLauncher: ProfileLauncher;
  apiServer: LocalApiServer;
} {
  const dataDir = resolveDataDir();
  const dbPath = path.join(dataDir, 'antidetect.db');
  const profilesDir = path.join(dataDir, 'profiles');
  const logsDir = path.join(dataDir, 'logs');

  dbCtx = createDatabase(dbPath);
  const secrets = new SecretService(safeStorage);
  const logger = new AppLogger(logsDir);
  const profileService = new ProfileService(dbCtx.db, secrets, profilesDir);
  const proxyService = new ProxyService(dbCtx.db, secrets);
  const settingsService = new SettingsService(dbCtx.db);
  const profileLauncher = new ProfileLauncher(
    profileService,
    proxyService,
    settingsService,
    logger,
  );
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
    void apiServer.start(settings.localApiPort).catch((err) => {
      logger.error('main', `Could not start Local API: ${String(err)}`);
    });
  }

  logger.info('main', `Initialized services (dataDir=${dataDir})`);

  return {
    dataDir,
    logger,
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
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_START, (_e, id: string) => profileLauncher.start(id));
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_STOP, (_e, id: string) => profileLauncher.stop(id));
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_BULK_START, (_e, ids: string[]) =>
    profileLauncher.bulkStart(ids),
  );
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_BULK_STOP, (_e, ids: string[]) =>
    profileLauncher.bulkStop(ids),
  );
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_RUNNING_IDS, () => profileLauncher.getRunningIds());

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
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0e14',
    title: 'Antidetect Browser',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
