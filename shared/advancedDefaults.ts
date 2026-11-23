import type {
  ProfileBandwidth,
  ProfileBehavior,
  ProfileDataOnClose,
  ProfileMediaDevices,
  ProfileMeta,
  ProfileSignals,
  ProfileWindow,
} from './types';

export const DEFAULT_SIGNALS: ProfileSignals = {
  canvas: 'noise',
  webgl: 'noise',
  webglMetadata: 'custom',
  audio: 'noise',
  clientRects: 'noise',
  fonts: 'custom',
  speechVoices: 'custom',
  battery: 'off',
  portScanProtect: true,
};

export const DEFAULT_MEDIA_DEVICES: ProfileMediaDevices = {
  cameras: 1,
  microphones: 1,
  speakers: 1,
  mode: 'fake',
};

export const DEFAULT_DATA_ON_CLOSE: ProfileDataOnClose = {
  clearCookies: false,
  clearCache: false,
  clearHistory: false,
  clearLocalStorage: false,
};

export const DEFAULT_WINDOW: ProfileWindow = {
  width: 1280,
  height: 800,
  x: null,
  y: null,
  randomizeSlightly: false,
  maximized: false,
};

export const DEFAULT_BANDWIDTH: ProfileBandwidth = {
  blockImages: false,
  blockMedia: false,
  blockExternalFonts: false,
  blockAds: false,
  blockTrackers: false,
  cacheStaticResources: false,
};

export const DEFAULT_BEHAVIOR: ProfileBehavior = {
  doNotTrack: false,
  notifications: 'block',
  hardwareAcceleration: true,
  geolocationPrompt: 'allow',
  disableAutofill: true,
  disableGoogleSync: true,
};

export const DEFAULT_META: ProfileMeta = {
  notes: '',
  color: '#10b981',
  expiresAt: null,
};

export function normalizeSignals(partial?: Partial<ProfileSignals> | null): ProfileSignals {
  return {
    ...DEFAULT_SIGNALS,
    ...(partial ?? {}),
  };
}

export function normalizeMediaDevices(
  partial?: Partial<ProfileMediaDevices> | null,
): ProfileMediaDevices {
  const merged = { ...DEFAULT_MEDIA_DEVICES, ...(partial ?? {}) };
  return {
    cameras: Math.max(0, Math.min(8, Math.floor(Number(merged.cameras) || 0))),
    microphones: Math.max(0, Math.min(8, Math.floor(Number(merged.microphones) || 0))),
    speakers: Math.max(0, Math.min(8, Math.floor(Number(merged.speakers) || 0))),
    mode: merged.mode === 'real' ? 'real' : 'fake',
  };
}

export function normalizeDataOnClose(
  partial?: Partial<ProfileDataOnClose> | null,
): ProfileDataOnClose {
  return {
    ...DEFAULT_DATA_ON_CLOSE,
    ...(partial ?? {}),
  };
}

export function normalizeWindow(
  partial?: Partial<ProfileWindow> | null,
  fallbackScreen?: { width: number; height: number },
): ProfileWindow {
  const baseWidth = fallbackScreen ? Math.min(1280, fallbackScreen.width) : DEFAULT_WINDOW.width;
  const baseHeight = fallbackScreen ? Math.min(800, fallbackScreen.height) : DEFAULT_WINDOW.height;
  return {
    width: Math.max(320, Math.floor(Number(partial?.width ?? baseWidth) || baseWidth)),
    height: Math.max(240, Math.floor(Number(partial?.height ?? baseHeight) || baseHeight)),
    x: partial?.x ?? null,
    y: partial?.y ?? null,
    randomizeSlightly: Boolean(partial?.randomizeSlightly ?? DEFAULT_WINDOW.randomizeSlightly),
    maximized: Boolean(partial?.maximized ?? DEFAULT_WINDOW.maximized),
  };
}

export function normalizeBandwidth(partial?: Partial<ProfileBandwidth> | null): ProfileBandwidth {
  return {
    ...DEFAULT_BANDWIDTH,
    ...(partial ?? {}),
  };
}

export function normalizeBehavior(partial?: Partial<ProfileBehavior> | null): ProfileBehavior {
  return {
    ...DEFAULT_BEHAVIOR,
    ...(partial ?? {}),
  };
}

export function normalizeMeta(
  partial?: Partial<ProfileMeta> | null,
  legacyNotes = '',
): ProfileMeta {
  return {
    notes: partial?.notes ?? legacyNotes ?? '',
    color: partial?.color || DEFAULT_META.color,
    expiresAt: partial?.expiresAt ?? null,
  };
}
