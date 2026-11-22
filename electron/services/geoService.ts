import crypto from 'node:crypto';
import tzlookup from 'tz-lookup';
import localeMapRaw from './localeMap.json';

export interface LocaleMapping {
  locale: string;
  acceptLanguage: string;
}

export interface GeoSourceInfo {
  countryCode: string;
  timezone: string;
  lat: number | null;
  lon: number | null;
}

export interface DerivedGeolocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface DerivedGeo {
  timezone: string;
  locale: string;
  acceptLanguage: string;
  geolocation: DerivedGeolocation | null;
}

const LOCALE_MAP: Record<string, LocaleMapping> = localeMapRaw as Record<string, LocaleMapping>;

const DEFAULT_LOCALE: LocaleMapping = {
  locale: 'en-US',
  acceptLanguage: 'en-US,en;q=0.9',
};

export function mapCountryToLocale(countryCode: string): LocaleMapping {
  const code = countryCode.trim().toUpperCase();
  return LOCALE_MAP[code] ?? DEFAULT_LOCALE;
}

export function buildAcceptLanguage(locale: string): string {
  const clean = locale.trim() || 'en-US';
  for (const entry of Object.values(LOCALE_MAP)) {
    if (entry.locale.toLowerCase() === clean.toLowerCase()) {
      return entry.acceptLanguage;
    }
  }
  const base = clean.split('-')[0] ?? 'en';
  if (base === 'en') {
    return `${clean},en;q=0.9`;
  }
  return `${clean},${base};q=0.9,en;q=0.8`;
}

/**
 * Produces deterministic coordinate noise in [-0.01, +0.01] degrees based on profileId,
 * so the same profile always resolves to the same geolocation for a given proxy IP.
 */
function deterministicOffset(profileId: string, salt: string): number {
  const digest = crypto.createHash('sha256').update(`${profileId}:${salt}`).digest();
  const intVal = digest.readUInt32BE(0);
  const unit = intVal / 0xffffffff; // [0, 1]
  return Number(((unit * 2 - 1) * 0.01).toFixed(6));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function deriveGeo(info: GeoSourceInfo, profileId = 'default'): DerivedGeo {
  const { locale, acceptLanguage } = mapCountryToLocale(info.countryCode);

  let timezone = info.timezone.trim();
  if (!timezone && info.lat !== null && info.lon !== null) {
    try {
      timezone = tzlookup(info.lat, info.lon);
    } catch {
      timezone = 'UTC';
    }
  }
  if (!timezone) {
    timezone = 'UTC';
  }

  let geolocation: DerivedGeolocation | null = null;
  if (info.lat !== null && info.lon !== null) {
    const latOffset = deterministicOffset(profileId, 'lat');
    const lonOffset = deterministicOffset(profileId, 'lon');
    geolocation = {
      latitude: Number(clamp(info.lat + latOffset, -90, 90).toFixed(6)),
      longitude: Number(clamp(info.lon + lonOffset, -180, 180).toFixed(6)),
      accuracy: 50,
    };
  }

  return {
    timezone,
    locale,
    acceptLanguage,
    geolocation,
  };
}
