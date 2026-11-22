import crypto from 'node:crypto';
import type { BrowserType, DevicePreset, Platform, ProfileFingerprint } from '@shared/types';
import type { GeneratedIdentity } from '@shared/ipc';
import presetsRaw from './presets.json';

const PRESETS: DevicePreset[] = presetsRaw as DevicePreset[];

const FIRST_NAMES = [
  'Essie',
  'Liam',
  'Noah',
  'Oliver',
  'Ava',
  'Sophia',
  'Mia',
  'Lucas',
  'Ethan',
  'Chloe',
  'Harper',
  'Evelyn',
  'Mason',
  'Logan',
  'Aria',
  'Zoe',
  'Hannah',
  'Leo',
  'Nora',
  'Julian',
];

const LAST_NAMES = [
  'Crooks',
  'Carter',
  'Mitchell',
  'Bennett',
  'Brooks',
  'Hayes',
  'Parker',
  'Collins',
  'Foster',
  'Morgan',
  'Reed',
  'Sullivan',
  'Price',
  'Cooper',
  'Ward',
  'Turner',
  'Bailey',
  'Rivera',
  'Morris',
  'Rogers',
];

export function listDevicePresets(): DevicePreset[] {
  return PRESETS;
}

export function randomProfileName(): string {
  const first = FIRST_NAMES[crypto.randomInt(0, FIRST_NAMES.length)] ?? 'Alex';
  const last = LAST_NAMES[crypto.randomInt(0, LAST_NAMES.length)] ?? 'Morgan';
  return `${first} ${last}`;
}

export function generateConsistentIdentity(
  platform: Platform,
  browser: BrowserType = 'chrome',
): GeneratedIdentity {
  const exactPool = PRESETS.filter((p) => p.platform === platform && p.browser === browser);
  const platformPool = PRESETS.filter((p) => p.platform === platform);
  const pool = exactPool.length > 0 ? exactPool : platformPool;
  const chosen = pool[crypto.randomInt(0, pool.length)] ?? PRESETS[0];

  if (!chosen) {
    throw new Error('No device presets available');
  }

  const fingerprint: ProfileFingerprint = {
    screen: { ...chosen.screen },
    hardware: { ...chosen.hardware },
    webgl: { ...chosen.webgl },
    canvasNoiseSeed: crypto.randomInt(100_000, 999_999_999),
    audioNoiseSeed: crypto.randomInt(100_000, 999_999_999),
    fonts: [...chosen.fonts],
    webrtc: 'replace',
  };

  return {
    platform: chosen.platform,
    osVersion: chosen.osVersion,
    browser: chosen.browser,
    browserVersion: chosen.browserVersion,
    userAgent: chosen.userAgent,
    fingerprint,
  };
}
