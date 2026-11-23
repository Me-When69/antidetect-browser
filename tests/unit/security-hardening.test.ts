import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { ProfileService } from '../../electron/services/profileService';
import { SecretService } from '../../electron/services/secretService';
import {
  assertTrustedIpcSender,
  ipcIdSchema,
  ipcVersionSchema,
} from '../../electron/services/ipcSecurity';
import { classifyProxyError } from '../../electron/services/proxyService';
import { classifyFirefoxLaunchError } from '../../electron/services/drivers/CamoufoxDriver';
import { ProfileLauncher } from '../../electron/services/launcher';
import { ProxyService } from '../../electron/services/proxyService';
import { SettingsService } from '../../electron/services/settingsService';
import { AppLogger } from '../../electron/services/logger';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import type { BackupPayload } from '@shared/types';
import type { BrowserDriver, DriverInstance } from '../../electron/services/drivers/BrowserDriver';
import { hasActiveBandwidthRules } from '../../electron/services/bandwidthRouter';
import { applyDiskDataOnClose } from '../../electron/services/dataCleaner';

describe('Security Hardening Regression Tests (E-001+)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      try {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows handle locks
      }
    }
  });

  it('E-001: rejects path traversal in getProfileDir and permanentDelete without deleting external folders', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-e001-'));
    tempDirs.push(baseDir);

    const profilesDir = path.join(baseDir, 'profiles');
    const victimDir = path.join(baseDir, 'victim-outside');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.mkdirSync(victimDir, { recursive: true });
    fs.writeFileSync(path.join(victimDir, 'keep.txt'), 'safe', 'utf8');

    const dbCtx = createDatabase(path.join(baseDir, 'antidetect.db'));
    const svc = new ProfileService(dbCtx.db, new SecretService(), profilesDir);

    expect(() => svc.getProfileDir('../victim-outside')).toThrow();
    expect(() => svc.getProfileDir('..\\victim-outside')).toThrow();
    expect(() => svc.getProfileDir('nested/id')).toThrow();
    expect(() => svc.permanentDelete('../victim-outside')).toThrow();

    // Victim directory outside profilesRootDir MUST remain untouched
    expect(fs.existsSync(path.join(victimDir, 'keep.txt'))).toBe(true);

    // Valid UUID / safe ID still resolves cleanly inside profilesRootDir
    const validDir = svc.getProfileDir('550e8400-e29b-41d4-a716-446655440000');
    expect(validDir.startsWith(path.resolve(profilesDir) + path.sep)).toBe(true);

    dbCtx.sqlite.close();
  });

  it('E-002: enforces trusted IPC sender check, Zod schemas, and zero raw ipcMain.handle in main.ts', () => {
    const fakeWebContents = { id: 1 } as unknown as Electron.WebContents;
    const otherWebContents = { id: 2 } as unknown as Electron.WebContents;
    const mockWin = {
      isDestroyed: () => false,
      webContents: fakeWebContents,
    };

    expect(() => assertTrustedIpcSender(fakeWebContents, mockWin)).not.toThrow();
    expect(() => assertTrustedIpcSender(otherWebContents, mockWin)).toThrow();
    expect(() => assertTrustedIpcSender(fakeWebContents, null)).toThrow();

    expect(() => ipcIdSchema.parse('')).toThrow();
    expect(() => ipcVersionSchema.parse('136.0.7103.92')).not.toThrow();
    expect(() => ipcVersionSchema.parse('136; rm -rf /')).toThrow();

    const mainSource = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.ts'), 'utf8');
    expect(mainSource.includes('ipcMain.handle(')).toBe(false);
  });

  it('E-003: configures CSP header, will-navigate guard, and setWindowOpenHandler deny in main.ts', () => {
    const mainSource = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.ts'), 'utf8');
    expect(mainSource).toContain('contextIsolation: true');
    expect(mainSource).toContain('nodeIntegration: false');
    expect(mainSource).toContain('sandbox: true');
    expect(mainSource).toContain('setWindowOpenHandler');
    expect(mainSource).toContain("on('will-navigate'");
    expect(mainSource).toContain('Content-Security-Policy');
  });

  it('E-005: classifies Firefox exitCode=0 and Chrome proxy/QUIC errors into clear Vietnamese messages', () => {
    const ffMsg = classifyFirefoxLaunchError(
      new Error(
        'browserType.launchPersistentContext: [pid=1234] <process did exit: exitCode=0, signal=null>',
      ),
    );
    expect(ffMsg).toContain('exitCode=0');
    expect(ffMsg).toContain('xung đột');

    expect(classifyProxyError(new Error('net::ERR_PROXY_CONNECTION_FAILED'))).toContain(
      'ERR_PROXY_CONNECTION_FAILED',
    );
    expect(classifyProxyError(new Error('net::ERR_TUNNEL_CONNECTION_FAILED'))).toContain(
      'ERR_TUNNEL_CONNECTION_FAILED',
    );
    expect(classifyProxyError(new Error('net::ERR_QUIC_PROTOCOL_ERROR'))).toContain(
      'ERR_QUIC_PROTOCOL_ERROR',
    );
  });

  it('E-006: enforces max concurrent profiles limit in ProfileLauncher.start', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-e006-'));
    tempDirs.push(baseDir);
    const dbCtx = createDatabase(path.join(baseDir, 'antidetect.db'));
    const secrets = new SecretService();
    const profileService = new ProfileService(dbCtx.db, secrets, path.join(baseDir, 'profiles'));
    const proxyService = new ProxyService(dbCtx.db, secrets);
    const settingsService = new SettingsService(dbCtx.db);
    const logger = new AppLogger();

    const makeProfile = (name: string) => {
      const id = generateConsistentIdentity('windows', 'chrome');
      return profileService.create({
        name,
        folderId: null,
        status: 'ready',
        tags: [],
        notes: '',
        platform: id.platform,
        osVersion: id.osVersion,
        browser: id.browser,
        browserVersion: id.browserVersion,
        userAgent: id.userAgent,
        proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
        ipv6Policy: 'block',
        geo: {
          mode: 'manual',
          timezone: 'Asia/Ho_Chi_Minh',
          language: 'vi-VN',
          lat: null,
          lon: null,
        },
        fingerprint: id.fingerprint,
        startup: { urls: [], restoreTabs: false },
      });
    };

    const p1 = makeProfile('P1');
    const p2 = makeProfile('P2');

    const instances = new Map<string, DriverInstance>();
    const mockDriver: BrowserDriver = {
      name: 'mock',
      launch: async (opts) => {
        const inst: DriverInstance = {
          profileId: opts.profile.id,
          wsEndpoint: `ws://127.0.0.1:9222/${opts.profile.id}`,
          close: async () => {
            instances.delete(opts.profile.id);
          },
          importCookies: async () => 0,
          exportCookies: async () => [],
          runWarmup: async () => ({ profileId: opts.profile.id, visited: 0, failed: 0 }),
        };
        instances.set(opts.profile.id, inst);
        return inst;
      },
      close: async (id) => {
        instances.delete(id);
      },
      isRunning: (id) => instances.has(id),
      getInstance: (id) => instances.get(id),
    };

    // Limit to 1 concurrent profile
    const launcher = new ProfileLauncher(
      profileService,
      proxyService,
      settingsService,
      logger,
      mockDriver,
      mockDriver,
      undefined,
      undefined,
      1,
    );

    const r1 = await launcher.start(p1.id);
    expect(r1.running).toBe(true);

    const r2 = await launcher.start(p2.id);
    expect(r2.running).toBe(false);
    expect(r2.error).toContain('giới hạn chạy đồng thời');

    await launcher.stopAll();
    dbCtx.sqlite.close();
  });

  it('E-008: rejects corrupted or invalid backup payload in ProfileService.importBackup', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-e008-'));
    tempDirs.push(baseDir);
    const dbCtx = createDatabase(path.join(baseDir, 'antidetect.db'));
    const svc = new ProfileService(dbCtx.db, new SecretService(), path.join(baseDir, 'profiles'));

    expect(() => svc.importBackup({} as BackupPayload)).toThrow(/File sao lưu không hợp lệ/);
    expect(() =>
      svc.importBackup({
        version: 1,
        exportedAt: new Date().toISOString(),
        folders: [],
        tags: [],
        proxies: [],
        profiles: [{ id: '../evil', name: 'Bad' }] as unknown as BackupPayload['profiles'],
      }),
    ).toThrow(/File sao lưu không hợp lệ/);

    dbCtx.sqlite.close();
  });

  it('E-010: covers bandwidthRouter rule detection and dataCleaner disk cleanup safely', () => {
    expect(hasActiveBandwidthRules(undefined)).toBe(false);
    expect(
      hasActiveBandwidthRules({
        blockImages: false,
        blockMedia: false,
        blockExternalFonts: false,
        blockAds: true,
        blockTrackers: false,
        cacheStaticResources: false,
      }),
    ).toBe(true);

    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-e010-'));
    tempDirs.push(baseDir);
    const cacheDir = path.join(baseDir, 'Default', 'Cache');
    const keepDir = path.join(baseDir, 'Default', 'Extensions');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(keepDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'c.bin'), 'cache', 'utf8');
    fs.writeFileSync(path.join(keepDir, 'ext.json'), '{}', 'utf8');

    applyDiskDataOnClose(baseDir, {
      clearCookies: false,
      clearCache: true,
      clearHistory: false,
      clearLocalStorage: false,
    });
    expect(fs.existsSync(cacheDir)).toBe(false);
    expect(fs.existsSync(path.join(keepDir, 'ext.json'))).toBe(true);
  });
});
