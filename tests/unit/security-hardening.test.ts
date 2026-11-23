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

    const mainSource = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main.ts'),
      'utf8',
    );
    expect(mainSource.includes('ipcMain.handle(')).toBe(false);
  });

  it('E-003: configures CSP header, will-navigate guard, and setWindowOpenHandler deny in main.ts', () => {
    const mainSource = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main.ts'),
      'utf8',
    );
    expect(mainSource).toContain('contextIsolation: true');
    expect(mainSource).toContain('nodeIntegration: false');
    expect(mainSource).toContain('sandbox: true');
    expect(mainSource).toContain('setWindowOpenHandler');
    expect(mainSource).toContain("on('will-navigate'");
    expect(mainSource).toContain('Content-Security-Policy');
  });

  it('E-005: classifies Firefox exitCode=0 and Chrome proxy/QUIC errors into clear Vietnamese messages', () => {
    const ffMsg = classifyFirefoxLaunchError(
      new Error('browserType.launchPersistentContext: [pid=1234] <process did exit: exitCode=0, signal=null>'),
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
});
