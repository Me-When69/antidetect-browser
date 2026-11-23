import { describe, expect, it } from 'vitest';
import {
  applyDevice,
  getDeviceById,
  getEmulationConfidence,
  listDevices,
  pickWeightedDevice,
} from '../../electron/services/deviceCatalog';
import {
  compareBrowserVersions,
  isVersionDowngrade,
  previewBulkVersionUpdate,
} from '../../electron/services/browserManager';
import { checkIdentityConsistency } from '../../shared/validation';
import type { CreateProfileInput, Profile } from '../../shared/types';

function makeBaseProfile(): CreateProfileInput {
  return {
    name: 'Unit Test Profile',
    folderId: null,
    status: 'none',
    tags: [],
    notes: '',
    platform: 'windows',
    osVersion: 'Windows 11',
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
      canvasNoiseSeed: 12345,
      audioNoiseSeed: 67890,
      fonts: ['Segoe UI', 'Arial'],
      webrtc: 'replace',
    },
    startup: { urls: [], restoreTabs: false },
  };
}

describe('deviceCatalog & applyDevice', () => {
  it('loads all 47 devices across 5 platforms with expected counts', () => {
    expect(listDevices('windows').length).toBeGreaterThanOrEqual(15);
    expect(listDevices('macos').length).toBeGreaterThanOrEqual(8);
    expect(listDevices('linux').length).toBeGreaterThanOrEqual(6);
    expect(listDevices('android').length).toBeGreaterThanOrEqual(12);
    expect(listDevices('ios').length).toBeGreaterThanOrEqual(6);
    expect(listDevices().length).toBe(47);
  });

  it('applyDevice passes checkIdentityConsistency for ALL 47 devices with real engine version', () => {
    const realVersion = '136.0.7103.93';
    const base = makeBaseProfile();
    const all = listDevices();

    for (const device of all) {
      const applied = applyDevice(base, device, realVersion);
      expect(applied.deviceId).toBe(device.id);
      expect(applied.deviceLabel).toBe(device.label);
      expect(applied.platform).toBe(device.platform);
      expect(applied.browserVersion).toBe(realVersion);

      if (device.platform === 'ios') {
        expect(device.clientHints).toBeNull();
        expect(applied.userAgent).not.toMatch(/Chrome\/\d+/i);
        expect(applied.userAgent).toMatch(/Safari/i);
      } else {
        expect(applied.userAgent).toContain(`Chrome/${realVersion}`);
        expect(applied.fingerprint.mobile).toBe(device.mobile);
        expect(applied.fingerprint.maxTouchPoints).toBe(device.touch.maxTouchPoints);
      }

      const report = checkIdentityConsistency(applied, null, {
        realEngineVersion: realVersion,
        browser: applied.browser,
      });
      const errors = report.warnings.filter((w) => w.severity === 'error');
      expect(
        errors,
        `Device ${device.id} failed consistency check: ${JSON.stringify(errors)}`,
      ).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it('rejects UA version mismatch when realEngineVersion differs from UA', () => {
    const base = makeBaseProfile();
    const device = getDeviceById('win11-rtx3060-1080p');
    expect(device).not.toBeNull();
    const applied = applyDevice(base, device!, '120.0.6099.109');

    const report = checkIdentityConsistency(applied, null, {
      realEngineVersion: '136.0.7103.93',
      browser: 'chrome',
    });
    expect(report.ok).toBe(false);
    expect(report.warnings.some((w) => w.code === 'UA_ENGINE_VERSION_MISMATCH')).toBe(true);
  });

  it('rejects iOS profile with Chrome UA', () => {
    const base = makeBaseProfile();
    const iosDevice = getDeviceById('ios-iphone-16-pro');
    expect(iosDevice).not.toBeNull();
    const applied = applyDevice(base, iosDevice!, '136.0.7103.93');
    const tampered = {
      ...applied,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/537.36 Chrome/136.0.0.0 Mobile Safari/537.36',
    };
    const report = checkIdentityConsistency(tampered, null, {
      realEngineVersion: '136.0.7103.93',
      browser: 'chrome',
    });
    expect(report.ok).toBe(false);
    expect(report.warnings.some((w) => w.code === 'IOS_CHROME_UA_MISMATCH')).toBe(true);
  });

  it('pickWeightedDevice is deterministic when given a seed', () => {
    const a = pickWeightedDevice('android', 42);
    const b = pickWeightedDevice('android', 42);
    expect(a.id).toBe(b.id);
    expect(a.platform).toBe('android');
  });

  it('getEmulationConfidence reports accurate levels per platform and host OS', () => {
    expect(getEmulationConfidence('windows', 'win32', 'chrome').level).toBe('high');
    expect(getEmulationConfidence('macos', 'win32', 'chrome').level).toBe('medium');
    expect(getEmulationConfidence('macos', 'win32', 'chrome').osMismatch).toBe(true);
    expect(getEmulationConfidence('android', 'win32', 'chrome').level).toBe('medium');
    expect(getEmulationConfidence('ios', 'win32', 'webkit').level).toBe('medium');
    expect(getEmulationConfidence('ios', 'win32', 'chrome').level).toBe('low');
  });
});

describe('browserManager version comparison & downgrade detection', () => {
  it('compares dotted browser versions accurately', () => {
    expect(compareBrowserVersions('136.0.7103.93', '135.0.7049.84')).toBeGreaterThan(0);
    expect(compareBrowserVersions('135.0.0.0', '136.0.0.0')).toBeLessThan(0);
    expect(compareBrowserVersions('136.0.0.0', '136.0.0.0')).toBe(0);
  });

  it('detects version downgrade correctly', () => {
    expect(isVersionDowngrade('136.0.7103.93', '135.0.7049.84')).toBe(true);
    expect(isVersionDowngrade('135.0.7049.84', '136.0.7103.93')).toBe(false);
    expect(isVersionDowngrade('136.0.7103.93', '136.0.7103.93')).toBe(false);
    expect(isVersionDowngrade(null, '135.0.0.0')).toBe(false);
  });

  it('previews bulk version updates with upgrade, same, and downgrade labels', () => {
    const makeP = (id: string, ver: string, last?: string): Profile => ({
      ...makeBaseProfile(),
      id,
      name: `P-${id}`,
      browserVersion: ver,
      lastBrowserVersion: last ?? ver,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      deletedAt: null,
    });

    const preview = previewBulkVersionUpdate(
      [makeP('1', '134.0.0.0'), makeP('2', '136.0.0.0'), makeP('3', '138.0.0.0')],
      '136.0.0.0',
    );
    expect(preview.map((p) => p.action)).toEqual(['upgrade', 'same', 'downgrade']);
  });
});
