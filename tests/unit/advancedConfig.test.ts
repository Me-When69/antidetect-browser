import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import { ProfileService } from '../../electron/services/profileService';
import { BUILTIN_PRESETS, PresetService } from '../../electron/services/presetService';
import { checkIdentityConsistency } from '../../shared/validation';
import {
  DEFAULT_BANDWIDTH,
  DEFAULT_BEHAVIOR,
  DEFAULT_DATA_ON_CLOSE,
  DEFAULT_MEDIA_DEVICES,
  DEFAULT_SIGNALS,
} from '../../shared/advancedDefaults';
import type { CreateProfileInput } from '../../shared/types';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-unit-adv-'));
  tempDirs.push(dir);
  return dir;
}

function makeProfileInput(): CreateProfileInput {
  return {
    name: 'Advanced Unit Profile',
    folderId: null,
    status: 'active',
    tags: [],
    notes: 'Legacy note',
    platform: 'windows',
    osVersion: 'Windows 11',
    deviceLabel: 'Dell XPS 15 Laptop',
    browser: 'chrome',
    browserVersion: '136.0.7103.93',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.93 Safari/537.36',
    proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
    ipv6Policy: 'block',
    geo: { mode: 'manual', timezone: 'UTC', language: 'en-US', lat: null, lon: null },
    fingerprint: {
      screen: { width: 1920, height: 1080, dpr: 1 },
      hardware: { cores: 8, memory: 16 },
      webgl: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      canvasNoiseSeed: 11111,
      audioNoiseSeed: 22222,
      fonts: ['Segoe UI', 'Arial'],
      webrtc: 'replace',
      signals: { ...DEFAULT_SIGNALS },
    },
    startup: { urls: [], restoreTabs: false },
    mediaDevices: { ...DEFAULT_MEDIA_DEVICES },
    dataOnClose: { ...DEFAULT_DATA_ON_CLOSE },
    window: {
      width: 1280,
      height: 800,
      x: null,
      y: null,
      randomizeSlightly: false,
      maximized: false,
    },
    bandwidth: { ...DEFAULT_BANDWIDTH },
    behavior: { ...DEFAULT_BEHAVIOR },
    meta: { notes: 'Legacy note', color: '#10b981', expiresAt: null },
    presetId: 'balanced',
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup locks
      }
    }
  }
});

describe('Advanced profile migration & defaults', () => {
  it('migrates legacy DB without advanced_json/preset_id and hydrates safe defaults', () => {
    const root = makeTempDir();
    const dbPath = path.join(root, 'legacy.db');

    // Create a legacy database missing advanced_json and preset_id
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder_id TEXT,
        status TEXT NOT NULL DEFAULT 'none',
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT 'windows',
        os_version TEXT NOT NULL DEFAULT 'Windows 11',
        browser TEXT NOT NULL DEFAULT 'chrome',
        browser_version TEXT NOT NULL DEFAULT '131.0.0.0',
        user_agent TEXT NOT NULL DEFAULT 'auto',
        proxy_json TEXT NOT NULL,
        geo_json TEXT NOT NULL,
        fingerprint_json TEXT NOT NULL,
        startup_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_run_at TEXT
      );
    `);
    raw
      .prepare(
        `INSERT INTO profiles (id, name, notes, proxy_json, geo_json, fingerprint_json, startup_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-1',
        'Old Profile',
        'Old notes here',
        JSON.stringify({ type: 'none', host: '', port: 0, username: '', password: '' }),
        JSON.stringify({
          mode: 'manual',
          timezone: 'UTC',
          language: 'en-US',
          lat: null,
          lon: null,
        }),
        JSON.stringify({
          screen: { width: 1920, height: 1080, dpr: 1 },
          hardware: { cores: 8, memory: 16 },
          webgl: { vendor: 'Google Inc.', renderer: 'ANGLE Direct3D11' },
          canvasNoiseSeed: 10,
          audioNoiseSeed: 20,
          fonts: ['Arial'],
          webrtc: 'replace',
        }),
        JSON.stringify({ urls: [], restoreTabs: false }),
        new Date().toISOString(),
      );
    raw.close();

    // Run modern createDatabase migration
    const dbCtx = createDatabase(dbPath);
    try {
      const svc = new ProfileService(dbCtx.db, new SecretService(), path.join(root, 'profiles'));
      const migrated = svc.getById('legacy-1');
      expect(migrated).not.toBeNull();
      expect(migrated!.fingerprint.signals).toEqual(DEFAULT_SIGNALS);
      expect(migrated!.mediaDevices).toEqual(DEFAULT_MEDIA_DEVICES);
      expect(migrated!.dataOnClose).toEqual(DEFAULT_DATA_ON_CLOSE);
      expect(migrated!.bandwidth).toEqual(DEFAULT_BANDWIDTH);
      expect(migrated!.behavior).toEqual(DEFAULT_BEHAVIOR);
      expect(migrated!.meta?.notes).toBe('Old notes here');
      expect(migrated!.meta?.color).toBe('#10b981');
      expect(migrated!.presetId).toBe('balanced');
    } finally {
      dbCtx.sqlite.close();
    }
  });
});

describe('Expanded consistencyCheck warnings', () => {
  it('warns when signals are off on GPU device, window > screen, cameras = 0, or images/fonts blocked', () => {
    const base = makeProfileInput();
    const mutated: CreateProfileInput = {
      ...base,
      proxy: { type: 'http', host: '1.2.3.4', port: 8080, username: '', password: '' },
      fingerprint: {
        ...base.fingerprint,
        webrtc: 'real',
        signals: {
          ...DEFAULT_SIGNALS,
          webgl: 'off',
          canvas: 'off',
          audio: 'off',
        },
      },
      window: {
        width: 2560,
        height: 1440,
        x: null,
        y: null,
        randomizeSlightly: false,
        maximized: false,
      },
      mediaDevices: { cameras: 0, microphones: 1, speakers: 1, mode: 'fake' },
      bandwidth: { ...DEFAULT_BANDWIDTH, blockImages: true, blockExternalFonts: true },
    };

    const report = checkIdentityConsistency(mutated);
    const codes = new Set(report.warnings.map((w) => w.code));
    expect(codes.has('WEBRTC_LEAK_RISK')).toBe(true);
    expect(codes.has('WEBGL_OFF_ON_GPU_DEVICE')).toBe(true);
    expect(codes.has('CANVAS_OFF_ANOMALY')).toBe(true);
    expect(codes.has('AUDIO_OFF_ANOMALY')).toBe(true);
    expect(codes.has('WINDOW_EXCEEDS_SCREEN')).toBe(true);
    expect(codes.has('MEDIA_ZERO_CAMERAS')).toBe(true);
    expect(codes.has('BANDWIDTH_DISPLAY_IMPACT')).toBe(true);
    expect(report.ok).toBe(false);
  });
});

describe('Presets & Bulk Apply', () => {
  it('validates all 4 built-in presets and supports custom preset save/delete + bulkUpdate', () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual([
      'balanced',
      'max-privacy',
      'low-bandwidth',
      'test-real',
    ]);
    const testReal = BUILTIN_PRESETS.find((p) => p.id === 'test-real')!;
    expect(testReal.signals.canvas).toBe('real');
    expect(testReal.signals.webgl).toBe('real');
    expect(testReal.signals.audio).toBe('real');
    expect(testReal.mediaDevices.mode).toBe('real');
    expect(testReal.webrtc).toBe('real');

    const root = makeTempDir();
    const dbCtx = createDatabase(path.join(root, 'presets.db'));
    try {
      const presetSvc = new PresetService(dbCtx.db);
      const saved = presetSvc.saveCustomPreset({
        name: 'Custom QA',
        description: 'My custom preset',
        signals: { ...DEFAULT_SIGNALS, canvas: 'real' },
        mediaDevices: { cameras: 2, microphones: 1, speakers: 2, mode: 'fake' },
        webrtc: 'replace',
        dataOnClose: { ...DEFAULT_DATA_ON_CLOSE, clearCache: true },
        bandwidth: { ...DEFAULT_BANDWIDTH, blockAds: true },
        behavior: { ...DEFAULT_BEHAVIOR, doNotTrack: true },
      });
      expect(presetSvc.listPresets().some((p) => p.id === saved.id)).toBe(true);
      expect(presetSvc.deleteCustomPreset('balanced')).toBe(false);

      const profileSvc = new ProfileService(
        dbCtx.db,
        new SecretService(),
        path.join(root, 'profiles'),
      );
      const p1 = profileSvc.create(makeProfileInput());
      const p2 = profileSvc.create({ ...makeProfileInput(), name: 'Second' });
      const updated = profileSvc.bulkUpdate({ ids: [p1.id, p2.id], presetId: 'max-privacy' });
      expect(updated).toBe(2);
      const reloaded = profileSvc.getById(p1.id)!;
      expect(reloaded.presetId).toBe('max-privacy');
      expect(reloaded.fingerprint.webrtc).toBe('disable');
      expect(reloaded.dataOnClose?.clearCookies).toBe(true);

      expect(presetSvc.deleteCustomPreset(saved.id)).toBe(true);
    } finally {
      dbCtx.sqlite.close();
    }
  });
});
