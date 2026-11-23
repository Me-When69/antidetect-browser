import windowsDevicesRaw from '../../data/devices/windows.json';
import macosDevicesRaw from '../../data/devices/macos.json';
import linuxDevicesRaw from '../../data/devices/linux.json';
import androidDevicesRaw from '../../data/devices/android.json';
import iosDevicesRaw from '../../data/devices/ios.json';
import type { BrowserType, CreateProfileInput, EmulatedDevice, Platform } from '../../shared/types';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface EmulationConfidence {
  level: ConfidenceLevel;
  label: 'Cao' | 'Trung bình' | 'Thấp';
  reason: string;
  osMismatch: boolean;
}

const ALL_DEVICES: readonly EmulatedDevice[] = [
  ...(windowsDevicesRaw as EmulatedDevice[]),
  ...(macosDevicesRaw as EmulatedDevice[]),
  ...(linuxDevicesRaw as EmulatedDevice[]),
  ...(androidDevicesRaw as EmulatedDevice[]),
  ...(iosDevicesRaw as EmulatedDevice[]),
];

const DEVICES_BY_ID = new Map<string, EmulatedDevice>(
  ALL_DEVICES.map((device) => [device.id, device]),
);

const DEVICES_BY_PLATFORM: Record<Platform, readonly EmulatedDevice[]> = {
  windows: windowsDevicesRaw as EmulatedDevice[],
  macos: macosDevicesRaw as EmulatedDevice[],
  linux: linuxDevicesRaw as EmulatedDevice[],
  android: androidDevicesRaw as EmulatedDevice[],
  ios: iosDevicesRaw as EmulatedDevice[],
};

export function listDevices(platform?: Platform): EmulatedDevice[] {
  if (platform) {
    return [...(DEVICES_BY_PLATFORM[platform] ?? [])];
  }
  return [...ALL_DEVICES];
}

export function getDeviceById(id: string): EmulatedDevice | null {
  return DEVICES_BY_ID.get(id) ?? null;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function pickWeightedDevice(platform: Platform, seed?: number): EmulatedDevice {
  const pool = DEVICES_BY_PLATFORM[platform];
  if (!pool || pool.length === 0) {
    throw new Error(`Không có cấu hình thiết bị nào cho nền tảng "${platform}".`);
  }
  const totalWeight = pool.reduce((sum, item) => sum + Math.max(1, item.weight ?? 1), 0);
  const r = (seed !== undefined ? seededRandom(seed) : Math.random()) * totalWeight;
  let acc = 0;
  for (const device of pool) {
    acc += Math.max(1, device.weight ?? 1);
    if (r <= acc) {
      return device;
    }
  }
  return pool[pool.length - 1]!;
}

/**
 * Normalize a browser version string into full Chrome form (e.g. "136" -> "136.0.0.0")
 * while preserving exact real engine versions like "136.0.7103.93".
 */
export function normalizeBrowserVersion(realBrowserVersion: string): string {
  const trimmed = realBrowserVersion.trim();
  if (!trimmed) return '136.0.0.0';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) return trimmed;
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) return `${trimmed}.0`;
  if (/^\d+\.\d+$/.test(trimmed)) return `${trimmed}.0.0`;
  if (/^\d+$/.test(trimmed)) return `${trimmed}.0.0.0`;
  const match = trimmed.match(/(\d+(?:\.\d+){0,3})/);
  if (match?.[1]) return normalizeBrowserVersion(match[1]);
  return trimmed;
}

export function extractMajorVersion(version: string): string {
  const match = version.trim().match(/^(\d+)/);
  return match?.[1] ?? '136';
}

/**
 * Build a User-Agent string strictly matching the real running browser engine version.
 * Never invents or fakes a browser version different from `realBrowserVersion`.
 */
export function renderUserAgent(
  device: EmulatedDevice,
  realBrowserVersion: string,
  browser: BrowserType = 'chrome',
): string {
  const normalized = normalizeBrowserVersion(realBrowserVersion);
  const major = extractMajorVersion(normalized);

  if (device.platform === 'ios') {
    // iOS uses Safari UA (no Chrome Client Hints)
    return device.uaTemplate.replace(/\{CHROME_VERSION\}/g, normalized);
  }

  if (browser === 'firefox') {
    if (device.platform === 'macos') {
      const macToken = device.osVersion.match(/(\d+)[._](\d+)/);
      const macVer = macToken ? `${macToken[1]}_${macToken[2]}` : '14_5';
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVer}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
    }
    if (device.platform === 'linux') {
      return `Mozilla/5.0 (X11; Linux x86_64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
    }
    if (device.platform === 'android') {
      const androidVer = device.osVersion.match(/(\d+)/)?.[1] ?? '14';
      return `Mozilla/5.0 (Android ${androidVer}; Mobile; rv:${major}.0) Gecko/${major}.0 Firefox/${major}.0`;
    }
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
  }

  return device.uaTemplate.replace(/\{CHROME_VERSION\}/g, normalized);
}

/**
 * Apply an emulated device preset onto a profile input, synchronizing UA, Client Hints
 * metadata, screen/viewport/DPR, GPU, hardware, touch, and fonts with `realBrowserVersion`.
 */
export function applyDevice(
  baseProfile: CreateProfileInput,
  device: EmulatedDevice,
  realBrowserVersion: string,
): CreateProfileInput {
  const effectiveBrowser: BrowserType =
    device.platform === 'ios'
      ? baseProfile.browser === 'webkit'
        ? 'webkit'
        : 'chrome'
      : device.platform === 'android'
        ? 'chrome'
        : baseProfile.browser === 'webkit'
          ? 'chrome'
          : baseProfile.browser;

  const normalizedVersion = normalizeBrowserVersion(realBrowserVersion);
  const userAgent = renderUserAgent(device, normalizedVersion, effectiveBrowser);
  const hints = device.clientHints;

  return {
    ...baseProfile,
    platform: device.platform,
    osVersion: device.osVersion,
    deviceId: device.id,
    deviceLabel: device.label,
    browser: effectiveBrowser,
    browserVersion: normalizedVersion,
    userAgent,
    fingerprint: {
      ...baseProfile.fingerprint,
      screen: {
        width: device.screen.width,
        height: device.screen.height,
        dpr: device.screen.dpr,
      },
      hardware: {
        cores: device.hardware.cores,
        memory: device.hardware.memory,
      },
      webgl: {
        vendor: device.gpu.vendor,
        renderer: device.gpu.renderer,
      },
      fonts: [...device.fonts],
      mobile: device.mobile,
      maxTouchPoints: device.touch.maxTouchPoints,
      model: hints ? hints.model : (device.model ?? ''),
      architecture: hints ? hints.architecture : '',
      bitness: hints ? hints.bitness : '',
      platformVersion: hints ? hints.platformVersion : '',
    },
  };
}

export function nodePlatformToAppPlatform(hostPlatform: NodeJS.Platform): Platform {
  if (hostPlatform === 'darwin') return 'macos';
  if (hostPlatform === 'linux') return 'linux';
  return 'windows';
}

export function getEmulationConfidence(
  targetPlatform: Platform,
  hostPlatform: NodeJS.Platform = process.platform,
  browser: BrowserType = 'chrome',
): EmulationConfidence {
  const hostAppPlatform = nodePlatformToAppPlatform(hostPlatform);
  const osMismatch = targetPlatform !== hostAppPlatform;

  if (targetPlatform === 'ios') {
    if (browser === 'webkit') {
      return {
        level: 'medium',
        label: 'Trung bình',
        reason:
          'Giả lập iOS trên nhân WebKit desktop: không gửi Chrome Client Hints, nhưng font hệ thống và GPU vẫn là của máy chủ.',
        osMismatch: true,
      };
    }
    return {
      level: 'low',
      label: 'Thấp',
      reason:
        'Giả lập iOS bằng nhân Chromium có độ tin cậy thấp vì hành vi JavaScript/CSS engine khác Safari thật. Chỉ nên dùng để kiểm tra giao diện cơ bản.',
      osMismatch: true,
    };
  }

  if (targetPlatform === 'android') {
    return {
      level: 'medium',
      label: 'Trung bình',
      reason:
        'Giả lập Android qua Chromium CDP (touch, viewport, Client Hints mobile đầy đủ), nhưng GPU render và font hệ thống vẫn thuộc máy chủ desktop.',
      osMismatch: true,
    };
  }

  if (!osMismatch) {
    return {
      level: 'high',
      label: 'Cao',
      reason:
        'Hệ điều hành giả lập trùng với máy chủ và dùng đúng phiên bản nhân trình duyệt thật đang chạy.',
      osMismatch: false,
    };
  }

  return {
    level: 'medium',
    label: 'Trung bình',
    reason:
      'Hệ điều hành giả lập khác hệ điều hành máy chủ: các thuộc tính trình duyệt được khớp nhất quán nhưng font hệ thống, canvas và GPU thật vẫn là của máy bạn.',
    osMismatch: true,
  };
}
