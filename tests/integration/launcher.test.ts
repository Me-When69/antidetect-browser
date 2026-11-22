import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import { ProfileService } from '../../electron/services/profileService';
import { ProxyService, type ProxyHttpFetcher } from '../../electron/services/proxyService';
import { SettingsService } from '../../electron/services/settingsService';
import { AppLogger } from '../../electron/services/logger';
import { ProfileLauncher } from '../../electron/services/launcher';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import type { ProfileRunStatusEvent } from '@shared/types';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-int-launcher-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient locks
      }
    }
  }
});

describe('Integration: ProfileLauncher & Geo auto/manual guard', () => {
  it('quản lý trạng thái Chạy/Dừng, chặn mở trùng profile, và không mở trình duyệt khi geo auto gặp lỗi proxy', async () => {
    const root = makeTempDir();
    const dbCtx = createDatabase(path.join(root, 'launcher.db'));
    const secrets = new SecretService(null);
    const logger = new AppLogger(path.join(root, 'logs'));
    const profileService = new ProfileService(dbCtx.db, secrets, path.join(root, 'profiles'));

    const failingFetcher: ProxyHttpFetcher = async () => {
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      throw err;
    };
    const proxyService = new ProxyService(dbCtx.db, secrets, failingFetcher);
    const settingsService = new SettingsService(dbCtx.db);
    const launcher = new ProfileLauncher(profileService, proxyService, settingsService, logger);

    const events: ProfileRunStatusEvent[] = [];
    launcher.onStatusChange((ev) => events.push(ev));

    const identity = generateConsistentIdentity('windows', 'chrome');

    // 1. Auto geo with failing proxy -> must NOT launch browser
    const autoProfile = profileService.create({
      name: 'Auto Fail Profile',
      folderId: null,
      status: 'none',
      tags: [],
      notes: '',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: 'chrome',
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: { type: 'http', host: '127.0.0.1', port: 1, username: '', password: '' },
      ipv6Policy: 'block',
      geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
      fingerprint: identity.fingerprint,
      startup: { urls: [], restoreTabs: false },
    });

    const failedLaunch = await launcher.start(autoProfile.id);
    expect(failedLaunch.running).toBe(false);
    expect(failedLaunch.proxyCheckFailed).toBe(true);
    expect(failedLaunch.error).toContain('Proxy từ chối kết nối');
    expect(launcher.isRunning(autoProfile.id)).toBe(false);

    // 2. Manual geo ignores proxy IP check and launches real Chrome cleanly
    const manualProfile = profileService.create({
      name: 'Manual Profile',
      folderId: null,
      status: 'none',
      tags: [],
      notes: '',
      platform: identity.platform,
      osVersion: identity.osVersion,
      browser: 'chrome',
      browserVersion: identity.browserVersion,
      userAgent: identity.userAgent,
      proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
      ipv6Policy: 'block',
      geo: {
        mode: 'manual',
        timezone: 'America/New_York',
        language: 'en-US',
        lat: 40.7128,
        lon: -74.006,
      },
      fingerprint: identity.fingerprint,
      startup: { urls: [], restoreTabs: false },
    });

    try {
      const res1 = await launcher.start(manualProfile.id);
      expect(res1.running).toBe(true);
      expect(res1.wsEndpoint).toContain('ws://127.0.0.1:');
      expect(launcher.getRunningIds()).toEqual([manualProfile.id]);

      // Duplicate start returns existing wsEndpoint without spawning a second browser
      const res2 = await launcher.start(manualProfile.id);
      expect(res2.wsEndpoint).toBe(res1.wsEndpoint);
      expect(launcher.getRunningIds()).toEqual([manualProfile.id]);

      await launcher.stopAll();
      expect(launcher.getRunningIds()).toEqual([]);
      expect(events.some((e) => e.profileId === manualProfile.id && e.running)).toBe(true);
      expect(events.some((e) => e.profileId === manualProfile.id && !e.running)).toBe(true);
    } finally {
      await launcher.stopAll();
      dbCtx.sqlite.close();
    }
  }, 60_000);
});
