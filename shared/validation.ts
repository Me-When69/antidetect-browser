import { z } from 'zod';
import type {
  BrowserType,
  CookieItem,
  CreateProfileInput,
  CsvProfileRow,
  IdentityCheckResult,
  IdentityCheckWarning,
  Platform,
  ProfileProxy,
  ProxyCheckResult,
  ProxyType,
} from './types';

const PROXY_TYPE_VALUES = [
  'none',
  'http',
  'https',
  'socks4',
  'socks4a',
  'socks5',
  'socks5h',
  'ssh',
  'shadowsocks',
  'vmess',
  'vless',
  'trojan',
] as const;

const baseProxySchema = z.object({
  type: z.enum(PROXY_TYPE_VALUES),
  host: z.string(),
  port: z.number().int().min(0).max(65535),
  username: z.string(),
  password: z.string(),
  privateKey: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});

export const profileProxySchema = baseProxySchema.extend({
  chain: z.array(baseProxySchema).max(3).optional(),
});

export const profileGeoSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  timezone: z.string(),
  language: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
});

export const profileFingerprintSchema = z.object({
  screen: z.object({
    width: z.number().int().min(320).max(7680),
    height: z.number().int().min(240).max(4320),
    dpr: z.number().min(0.5).max(4),
  }),
  hardware: z.object({
    cores: z.number().int().min(1).max(128),
    memory: z.number().int().min(1).max(256),
  }),
  webgl: z.object({
    vendor: z.string(),
    renderer: z.string(),
  }),
  canvasNoiseSeed: z.number().int(),
  audioNoiseSeed: z.number().int(),
  fonts: z.array(z.string()),
  webrtc: z.enum(['replace', 'disable', 'real']),
  mobile: z.boolean().optional(),
  maxTouchPoints: z.number().int().min(0).max(20).optional(),
  model: z.string().optional(),
  architecture: z.string().optional(),
  bitness: z.string().optional(),
  platformVersion: z.string().optional(),
});

export const profileFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên hồ sơ không được để trống').max(120),
    folderId: z.string().nullable(),
    status: z.enum(['none', 'active', 'banned', 'warming', 'ready']),
    tags: z.array(z.string()),
    notes: z.string(),
    platform: z.enum(['windows', 'macos', 'linux', 'android', 'ios']),
    osVersion: z.string().min(1),
    deviceId: z.string().nullable().optional(),
    deviceLabel: z.string().optional(),
    browser: z.enum(['chrome', 'firefox', 'webkit']),
    browserVersion: z.string().min(1),
    lastBrowserVersion: z.string().nullable().optional(),
    userAgent: z.string().min(1),
    proxy: profileProxySchema,
    ipv6Policy: z.enum(['block', 'proxy-only']),
    geo: profileGeoSchema,
    fingerprint: profileFingerprintSchema,
    startup: z.object({
      urls: z.array(z.string()),
      restoreTabs: z.boolean(),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.proxy.type !== 'none') {
      if (!data.proxy.host.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['proxy', 'host'],
          message: 'Vui lòng nhập host proxy',
        });
      }
      if (data.proxy.port <= 0 || data.proxy.port > 65535) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['proxy', 'port'],
          message: 'Port proxy phải từ 1 đến 65535',
        });
      }
    }
  });

function decodeBase64Utf8(raw: string): string {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === 'function') {
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function parseQuickProxyDetailed(
  raw: string,
  defaultType: Exclude<ProxyType, 'none'> = 'http',
): { ok: true; proxy: ProfileProxy } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Chuỗi proxy trống' };
  }

  // ss://
  if (/^ss:\/\//i.test(trimmed)) {
    const body = trimmed.slice(5).split('#')[0] ?? '';
    let method = '';
    let password = '';
    let host = '';
    let port = 0;
    if (body.includes('@')) {
      const atIdx = body.lastIndexOf('@');
      const uRaw = body.slice(0, atIdx);
      const hpRaw = (body.slice(atIdx + 1).split('?')[0] ?? '').trim();
      const dec = uRaw.includes(':') ? decodeURIComponent(uRaw) : decodeBase64Utf8(uRaw);
      const cIdx = dec.indexOf(':');
      method = cIdx > 0 ? dec.slice(0, cIdx).toLowerCase() : '';
      password = cIdx > 0 ? dec.slice(cIdx + 1) : '';
      const hp = /^(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/.exec(hpRaw);
      host = (hp?.[1] ?? hp?.[2] ?? '').trim();
      port = Number(hp?.[3] ?? '0');
    } else {
      const dec = decodeBase64Utf8(body.split('?')[0] ?? '');
      const m = /^([^:]+):([^@]*)@(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/.exec(dec.trim());
      method = (m?.[1] ?? '').toLowerCase();
      password = m?.[2] ?? '';
      host = (m?.[3] ?? m?.[4] ?? '').trim();
      port = Number(m?.[5] ?? '0');
    }
    if (!method || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Chuỗi Shadowsocks (ss://) không hợp lệ' };
    }
    return {
      ok: true,
      proxy: { type: 'shadowsocks', host, port, username: '', password, extra: { cipher: method } },
    };
  }

  // vmess://
  if (/^vmess:\/\//i.test(trimmed)) {
    try {
      const json = JSON.parse(decodeBase64Utf8(trimmed.slice(8))) as Record<string, unknown>;
      const host = typeof json['add'] === 'string' ? json['add'].trim() : '';
      const port = Number(json['port']);
      const uuid = typeof json['id'] === 'string' ? json['id'].trim() : '';
      if (!uuid || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'VMess thiếu UUID, host hoặc port hợp lệ' };
      }
      return {
        ok: true,
        proxy: {
          type: 'vmess',
          host,
          port,
          username: '',
          password: '',
          extra: {
            uuid,
            network: typeof json['net'] === 'string' ? json['net'] : 'tcp',
            tls: typeof json['tls'] === 'string' ? json['tls'] : 'none',
            sni: typeof json['sni'] === 'string' ? json['sni'] : '',
            path: typeof json['path'] === 'string' ? json['path'] : '',
          },
        },
      };
    } catch {
      return { ok: false, error: 'Chuỗi VMess không phải base64 JSON hợp lệ' };
    }
  }

  // vless://
  if (/^vless:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const uuid = decodeURIComponent(u.username).trim();
      const host = u.hostname.replace(/^\[|\]$/g, '');
      const port = Number(u.port);
      if (!uuid || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'VLESS thiếu UUID, host hoặc port hợp lệ' };
      }
      return {
        ok: true,
        proxy: {
          type: 'vless',
          host,
          port,
          username: '',
          password: '',
          extra: {
            uuid,
            network: u.searchParams.get('type') ?? 'tcp',
            tls: u.searchParams.get('security') ?? 'none',
            sni: u.searchParams.get('sni') ?? '',
            path: u.searchParams.get('path') ?? '',
          },
        },
      };
    } catch {
      return { ok: false, error: 'URL VLESS không hợp lệ' };
    }
  }

  // trojan://
  if (/^trojan:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const password = decodeURIComponent(u.username);
      const host = u.hostname.replace(/^\[|\]$/g, '');
      const port = Number(u.port);
      if (!password || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'Trojan thiếu mật khẩu, host hoặc port hợp lệ' };
      }
      return {
        ok: true,
        proxy: {
          type: 'trojan',
          host,
          port,
          username: '',
          password,
          extra: {
            network: u.searchParams.get('type') ?? 'tcp',
            tls: u.searchParams.get('security') ?? 'tls',
            sni: u.searchParams.get('sni') ?? host,
            path: u.searchParams.get('path') ?? '',
          },
        },
      };
    } catch {
      return { ok: false, error: 'URL Trojan không hợp lệ' };
    }
  }

  // Reject unknown URL schemes (e.g. ftp://)
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) &&
    !/^(https?|socks4a?|socks5h?|ssh):\/\//i.test(trimmed)
  ) {
    return {
      ok: false,
      error: 'Giao thức proxy không được hỗ trợ',
    };
  }

  // Detect unbracketed IPv6
  const withoutScheme = trimmed.replace(/^(https?|socks4a?|socks5h?|ssh):\/\//i, '');
  const hostCandidate = withoutScheme.includes('@')
    ? (withoutScheme.split('@').pop() ?? '')
    : withoutScheme;
  if (!hostCandidate.startsWith('[') && hostCandidate.includes('::')) {
    return {
      ok: false,
      error:
        'Địa chỉ IPv6 phải đặt trong ngoặc vuông, ví dụ: [::1]:8080 hoặc http://user:pass@[2001:db8::1]:8080',
    };
  }

  // URL format: scheme://[user:pass@]([ipv6]|host):port
  const urlMatch =
    /^(https?|socks4a?|socks5h?|ssh):\/\/(?:([^:@\s]+)(?::([^@\s]*))?@)?(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/i.exec(
      trimmed,
    );
  if (urlMatch) {
    const type = (urlMatch[1]?.toLowerCase() ?? defaultType) as Exclude<ProxyType, 'none'>;
    const host = (urlMatch[4] ?? urlMatch[5] ?? '').trim();
    const port = Number(urlMatch[6]);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Host hoặc port proxy không hợp lệ' };
    }
    return {
      ok: true,
      proxy: {
        type,
        host,
        port,
        username: decodeURIComponent(urlMatch[2] ?? ''),
        password: decodeURIComponent(urlMatch[3] ?? ''),
      },
    };
  }

  // Auth without scheme: user:pass@([ipv6]|host):port
  const authNoSchemeMatch = /^([^:@\s]+):([^@\s]*)@(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/.exec(
    trimmed,
  );
  if (authNoSchemeMatch) {
    const host = (authNoSchemeMatch[3] ?? authNoSchemeMatch[4] ?? '').trim();
    const port = Number(authNoSchemeMatch[5]);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Host hoặc port proxy không hợp lệ' };
    }
    return {
      ok: true,
      proxy: {
        type: defaultType,
        host,
        port,
        username: decodeURIComponent(authNoSchemeMatch[1] ?? ''),
        password: decodeURIComponent(authNoSchemeMatch[2] ?? ''),
      },
    };
  }

  // Bracketed IPv6 without scheme: [::1]:8080 or [::1]:8080:user:pass
  const bracketMatch = /^\[([^\]]+)\]:(\d+)(?::([^:]*):(.*))?$/.exec(trimmed);
  if (bracketMatch) {
    const host = (bracketMatch[1] ?? '').trim();
    const port = Number(bracketMatch[2]);
    if (!host.includes(':') || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Địa chỉ IPv6 hoặc port không hợp lệ' };
    }
    return {
      ok: true,
      proxy: {
        type: defaultType,
        host,
        port,
        username: bracketMatch[3] ?? '',
        password: bracketMatch[4] ?? '',
      },
    };
  }

  // Colon format: host:port or host:port:user:pass
  const parts = trimmed.split(':');
  if (parts.length === 2 || parts.length >= 4) {
    const host = parts[0]?.trim() ?? '';
    const port = Number(parts[1]?.trim() ?? '0');
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return {
        ok: false,
        error: 'Định dạng proxy không hợp lệ (dùng host:port:user:pass hoặc URL)',
      };
    }
    const username = parts.length >= 4 ? (parts[2] ?? '') : '';
    const password = parts.length >= 4 ? parts.slice(3).join(':') : '';
    return {
      ok: true,
      proxy: {
        type: defaultType,
        host,
        port,
        username,
        password,
      },
    };
  }

  return { ok: false, error: 'Định dạng proxy không hợp lệ' };
}

export function parseQuickProxy(
  raw: string,
  defaultType: Exclude<ProxyType, 'none'> = 'http',
): ProfileProxy | null {
  const res = parseQuickProxyDetailed(raw, defaultType);
  return res.ok ? res.proxy : null;
}

const COUNTRY_LANGUAGE_MAP: Record<string, string> = {
  VN: 'vi-VN',
  US: 'en-US',
  GB: 'en-GB',
  CA: 'en-CA',
  AU: 'en-AU',
  DE: 'de-DE',
  FR: 'fr-FR',
  JP: 'ja-JP',
  KR: 'ko-KR',
  SG: 'en-SG',
  TH: 'th-TH',
  ID: 'id-ID',
  NL: 'nl-NL',
  ES: 'es-ES',
  IT: 'it-IT',
  BR: 'pt-BR',
  RU: 'ru-RU',
  TW: 'zh-TW',
  HK: 'zh-HK',
};

export function inferLanguageFromCountry(countryCode: string): string {
  const upper = countryCode.trim().toUpperCase();
  return COUNTRY_LANGUAGE_MAP[upper] ?? 'en-US';
}

const OS_UA_MARKERS: Record<Platform, RegExp> = {
  windows: /Windows NT/i,
  macos: /Macintosh|Mac OS X/i,
  linux: /Linux|X11/i,
  android: /Android/i,
  ios: /iPhone|iPad|iOS|CPU OS/i,
};

const MAC_ONLY_FONTS = new Set(['San Francisco', 'Helvetica Neue', 'Apple Color Emoji', 'Menlo']);
const WIN_ONLY_FONTS = new Set(['Segoe UI', 'Calibri', 'Consolas', 'Cambria']);

export function checkIdentityConsistency(
  profile: Pick<CreateProfileInput, 'platform' | 'userAgent' | 'proxy' | 'geo' | 'fingerprint'>,
  proxyCheck?: ProxyCheckResult | null,
): IdentityCheckResult {
  const warnings: IdentityCheckWarning[] = [];

  // 1. OS vs User-Agent
  if (profile.userAgent !== 'auto' && !OS_UA_MARKERS[profile.platform].test(profile.userAgent)) {
    warnings.push({
      code: 'UA_OS_MISMATCH',
      severity: 'error',
      message: `User-Agent không khớp với nền tảng ${profile.platform.toUpperCase()}.`,
      suggestion: 'Đặt User-Agent về tự động hoặc sinh lại dấu vân tay khớp hệ điều hành.',
    });
  }

  // 2. OS vs GPU WebGL
  const renderer = profile.fingerprint.webgl.renderer.toLowerCase();
  if (profile.platform === 'windows' && (renderer.includes('apple') || renderer.includes('mesa'))) {
    warnings.push({
      code: 'GPU_OS_MISMATCH',
      severity: 'error',
      message: 'GPU WebGL kiểu Apple/Mesa không tự nhiên trên Windows.',
      suggestion: 'Chọn lại preset Windows (NVIDIA, Intel UHD hoặc AMD Radeon).',
    });
  }
  if (profile.platform === 'macos' && renderer.includes('direct3d')) {
    warnings.push({
      code: 'GPU_OS_MISMATCH',
      severity: 'error',
      message: 'GPU WebGL chứa Direct3D không tồn tại trên macOS.',
      suggestion: 'Chọn lại preset macOS (Apple M1/M2/M3 hoặc AMD/Intel Metal).',
    });
  }

  // 3. OS vs Fonts
  if (profile.platform === 'windows') {
    const hasMacFont = profile.fingerprint.fonts.some((f) => MAC_ONLY_FONTS.has(f));
    if (hasMacFont) {
      warnings.push({
        code: 'FONT_OS_MISMATCH',
        severity: 'warning',
        message: 'Danh sách font chứa font đặc trưng của macOS trên hồ sơ Windows.',
        suggestion: 'Loại bỏ font macOS và giữ bộ font chuẩn Windows.',
      });
    }
  } else if (profile.platform === 'macos') {
    const hasWinFont = profile.fingerprint.fonts.some((f) => WIN_ONLY_FONTS.has(f));
    if (hasWinFont) {
      warnings.push({
        code: 'FONT_OS_MISMATCH',
        severity: 'warning',
        message: 'Danh sách font chứa font đặc trưng của Windows trên hồ sơ macOS.',
        suggestion: 'Loại bỏ font Windows và giữ bộ font chuẩn macOS.',
      });
    }
  }

  // 4. WebRTC real with proxy enabled
  if (profile.proxy.type !== 'none' && profile.fingerprint.webrtc === 'real') {
    warnings.push({
      code: 'WEBRTC_LEAK_RISK',
      severity: 'error',
      message: 'WebRTC đang ở chế độ Real trong khi có sử dụng Proxy — dễ lộ IP thật.',
      suggestion: 'Chuyển WebRTC sang chế độ Replace hoặc Disable.',
    });
  }

  // 5. Proxy IP geo vs manual timezone/language
  if (proxyCheck && proxyCheck.ok) {
    if (profile.geo.mode === 'manual') {
      if (
        profile.geo.timezone &&
        proxyCheck.timezone &&
        profile.geo.timezone !== proxyCheck.timezone
      ) {
        warnings.push({
          code: 'TIMEZONE_IP_MISMATCH',
          severity: 'warning',
          message: `Múi giờ (${profile.geo.timezone}) không khớp với IP đầu ra (${proxyCheck.timezone}).`,
          suggestion: 'Bật chế độ tự động theo IP hoặc đổi múi giờ cho khớp.',
        });
      }
      const expectedLang = inferLanguageFromCountry(proxyCheck.countryCode);
      const primaryExpected = expectedLang.split('-')[0];
      const primaryCurrent = profile.geo.language.split('-')[0];
      if (
        profile.geo.language &&
        primaryExpected &&
        primaryCurrent &&
        primaryExpected !== primaryCurrent
      ) {
        warnings.push({
          code: 'LANGUAGE_IP_MISMATCH',
          severity: 'warning',
          message: `Ngôn ngữ (${profile.geo.language}) chưa khớp quốc gia IP (${proxyCheck.country} - gợi ý ${expectedLang}).`,
          suggestion: `Đổi ngôn ngữ sang ${expectedLang} hoặc bật tự động theo IP.`,
        });
      }
    }
  }

  const penalty = warnings.reduce((acc, w) => acc + (w.severity === 'error' ? 30 : 15), 0);
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    ok: warnings.filter((w) => w.severity === 'error').length === 0,
    warnings,
  };
}

export function parseCookiesText(raw: string): CookieItem[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  // JSON format
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const items: CookieItem[] = [];
    for (const entry of arr) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      const name = typeof rec['name'] === 'string' ? rec['name'] : '';
      const value = typeof rec['value'] === 'string' ? rec['value'] : '';
      const domain = typeof rec['domain'] === 'string' ? rec['domain'] : '';
      if (!name || !domain) continue;
      const sameSiteRaw =
        typeof rec['sameSite'] === 'string' ? rec['sameSite'].toLowerCase() : 'lax';
      const sameSite: CookieItem['sameSite'] =
        sameSiteRaw === 'strict' ? 'Strict' : sameSiteRaw === 'none' ? 'None' : 'Lax';
      const expiresNum =
        typeof rec['expires'] === 'number'
          ? rec['expires']
          : typeof rec['expirationDate'] === 'number'
            ? rec['expirationDate']
            : -1;
      items.push({
        name,
        value,
        domain,
        path: typeof rec['path'] === 'string' ? rec['path'] : '/',
        expires: expiresNum,
        httpOnly: Boolean(rec['httpOnly']),
        secure: Boolean(rec['secure']),
        sameSite,
      });
    }
    return items;
  }

  // Netscape format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue
  const items: CookieItem[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const cols = clean.split('\t');
    if (cols.length < 7) continue;
    const domain = cols[0] ?? '';
    const path = cols[2] ?? '/';
    const secure = (cols[3] ?? '').toUpperCase() === 'TRUE';
    const expires = Number(cols[4] ?? '-1');
    const name = cols[5] ?? '';
    const value = cols[6] ?? '';
    if (!domain || !name) continue;
    items.push({
      name,
      value,
      domain,
      path,
      expires: Number.isFinite(expires) ? expires : -1,
      httpOnly: false,
      secure,
      sameSite: 'Lax',
    });
  }
  return items;
}

export function serializeCookiesNetscape(cookies: CookieItem[]): string {
  const header = '# Netscape HTTP Cookie File\n# Exported by Antidetect Browser\n\n';
  const rows = cookies.map((c) => {
    const includeSubdomains = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const exp = c.expires > 0 ? Math.floor(c.expires) : 0;
    return [c.domain, includeSubdomains, c.path || '/', secure, String(exp), c.name, c.value].join(
      '\t',
    );
  });
  return header + rows.join('\n');
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseProfilesCsv(raw: string): CsvProfileRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCols = splitCsvLine(lines[0]!).map((c) => c.toLowerCase());
  const hasHeader =
    firstCols.includes('name') || firstCols.includes('proxy') || firstCols.includes('platform');

  const nameIdx = hasHeader ? Math.max(0, firstCols.indexOf('name')) : 0;
  const proxyIdx = hasHeader ? firstCols.indexOf('proxy') : 1;
  const tagsIdx = hasHeader ? firstCols.indexOf('tags') : 2;
  const notesIdx = hasHeader ? firstCols.indexOf('notes') : 3;
  const platformIdx = hasHeader ? firstCols.indexOf('platform') : 4;
  const browserIdx = hasHeader ? firstCols.indexOf('browser') : 5;

  const startRow = hasHeader ? 1 : 0;
  const rows: CsvProfileRow[] = [];

  for (let i = startRow; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]!);
    const name = cols[nameIdx]?.trim() || `Imported #${i + 1}`;
    const proxyRaw = proxyIdx >= 0 ? (cols[proxyIdx] ?? '') : '';
    const tagsRaw = tagsIdx >= 0 ? (cols[tagsIdx] ?? '') : '';
    const notes = notesIdx >= 0 ? (cols[notesIdx] ?? '') : '';
    const platformRaw = (platformIdx >= 0 ? (cols[platformIdx] ?? '') : '').toLowerCase();
    const browserRaw = (browserIdx >= 0 ? (cols[browserIdx] ?? '') : '').toLowerCase();

    const platform: Platform =
      platformRaw === 'macos' || platformRaw === 'mac'
        ? 'macos'
        : platformRaw === 'linux'
          ? 'linux'
          : 'windows';
    const browser: BrowserType =
      browserRaw === 'firefox' || browserRaw === 'camoufox' ? 'firefox' : 'chrome';
    const tags = tagsRaw
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    rows.push({ name, proxyRaw, tags, notes, platform, browser });
  }

  return rows;
}
