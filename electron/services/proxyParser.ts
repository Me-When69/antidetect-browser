import net from 'node:net';
import type { ProfileProxy, ProxyType } from '@shared/types';

export interface ParseProxyResult {
  ok: true;
  proxy: ProfileProxy;
  hostIpVersion: 0 | 4 | 6;
}

export interface ParseProxyError {
  ok: false;
  error: string;
}

export type ParseProxyOutcome = ParseProxyResult | ParseProxyError;

const IPV6_BRACKET_HINT =
  'Địa chỉ IPv6 phải đặt trong ngoặc vuông, ví dụ: [::1]:8080 hoặc http://user:pass@[2001:db8::1]:8080';

const SUPPORTED_SS_CIPHERS = new Set([
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-cfb',
  'aes-256-cfb',
  'rc4-md5',
  'none',
]);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifyHost(host: string): 0 | 4 | 6 {
  const v = net.isIP(host);
  return v === 4 ? 4 : v === 6 ? 6 : 0;
}

function decodeBase64Flexible(raw: string): string {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function looksLikeUnbracketedIpv6(input: string): boolean {
  const withoutScheme = input.replace(/^(https?|socks4a?|socks5h?|ssh):\/\//i, '');
  const hostPart = withoutScheme.includes('@')
    ? (withoutScheme.split('@').pop() ?? '')
    : withoutScheme;
  if (hostPart.startsWith('[')) {
    return false;
  }
  const colonCount = (hostPart.match(/:/g) ?? []).length;
  if (colonCount < 2) {
    return false;
  }
  if (net.isIP(hostPart) === 6) {
    return true;
  }
  const lastColon = hostPart.lastIndexOf(':');
  if (lastColon > 0 && net.isIP(hostPart.slice(0, lastColon)) === 6) {
    return true;
  }
  return hostPart.includes('::');
}

function parseShadowsocks(trimmed: string): ParseProxyOutcome {
  const body = trimmed.slice('ss://'.length).split('#')[0] ?? '';
  if (!body) {
    return { ok: false, error: 'Chuỗi Shadowsocks (ss://) trống hoặc thiếu thông tin' };
  }

  let method = '';
  let password = '';
  let host = '';
  let port = 0;

  if (body.includes('@')) {
    // SIP002: ss://base64(method:password)@host:port or ss://method:password@host:port
    const atIdx = body.lastIndexOf('@');
    const userInfoRaw = body.slice(0, atIdx);
    const hostPortPart = (body.slice(atIdx + 1).split('?')[0] ?? '').trim();

    let decodedUserInfo = userInfoRaw;
    if (!userInfoRaw.includes(':')) {
      decodedUserInfo = decodeBase64Flexible(userInfoRaw);
    } else {
      decodedUserInfo = decodeURIComponent(userInfoRaw);
    }
    const colonIdx = decodedUserInfo.indexOf(':');
    if (colonIdx <= 0) {
      return { ok: false, error: 'Thiếu phương thức mã hóa (cipher) hoặc mật khẩu Shadowsocks' };
    }
    method = decodedUserInfo.slice(0, colonIdx).trim().toLowerCase();
    password = decodedUserInfo.slice(colonIdx + 1);

    const hpMatch = /^(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/.exec(hostPortPart);
    if (!hpMatch) {
      return { ok: false, error: 'Host hoặc port Shadowsocks không hợp lệ' };
    }
    host = (hpMatch[1] ?? hpMatch[2] ?? '').trim();
    port = Number(hpMatch[3]);
  } else {
    // Legacy: ss://base64(method:password@host:port)
    const decoded = decodeBase64Flexible(body.split('?')[0] ?? '');
    const m = /^([^:]+):([^@]*)@(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/.exec(decoded.trim());
    if (!m) {
      return { ok: false, error: 'Không thể giải mã chuỗi Shadowsocks (ss://) base64' };
    }
    method = (m[1] ?? '').trim().toLowerCase();
    password = m[2] ?? '';
    host = (m[3] ?? m[4] ?? '').trim();
    port = Number(m[5]);
  }

  if (!SUPPORTED_SS_CIPHERS.has(method)) {
    return { ok: false, error: `Phương thức mã hóa Shadowsocks (cipher) không được hỗ trợ: ${method}` };
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Host hoặc port Shadowsocks không hợp lệ' };
  }

  return {
    ok: true,
    hostIpVersion: classifyHost(host),
    proxy: {
      type: 'shadowsocks',
      host,
      port,
      username: '',
      password,
      extra: { cipher: method },
    },
  };
}

function parseVmess(trimmed: string): ParseProxyOutcome {
  const b64 = trimmed.slice('vmess://'.length).trim();
  if (!b64) {
    return { ok: false, error: 'Chuỗi VMess (vmess://) trống' };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(decodeBase64Flexible(b64)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Chuỗi VMess không phải base64 JSON hợp lệ' };
  }

  const host = typeof json['add'] === 'string' ? json['add'].trim() : '';
  const port = Number(json['port']);
  const uuid = typeof json['id'] === 'string' ? json['id'].trim() : '';

  if (!uuid || !UUID_REGEX.test(uuid)) {
    return { ok: false, error: 'VMess thiếu UUID hoặc định dạng UUID không hợp lệ' };
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'VMess thiếu host (add) hoặc port không hợp lệ' };
  }

  const extra: Record<string, string> = {
    uuid,
    network: typeof json['net'] === 'string' && json['net'] ? json['net'] : 'tcp',
    tls: typeof json['tls'] === 'string' && json['tls'] ? json['tls'] : 'none',
    sni: typeof json['sni'] === 'string' ? json['sni'] : typeof json['host'] === 'string' ? json['host'] : '',
    path: typeof json['path'] === 'string' ? json['path'] : '',
    security: typeof json['scy'] === 'string' && json['scy'] ? json['scy'] : 'auto',
  };

  return {
    ok: true,
    hostIpVersion: classifyHost(host),
    proxy: {
      type: 'vmess',
      host,
      port,
      username: '',
      password: '',
      extra,
    },
  };
}

function parseVless(trimmed: string): ParseProxyOutcome {
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'URL VLESS (vless://) không hợp lệ' };
  }
  const uuid = decodeURIComponent(parsed.username).trim();
  const host = parsed.hostname.replace(/^\[|\]$/g, '').trim();
  const port = Number(parsed.port);

  if (!uuid || !UUID_REGEX.test(uuid)) {
    return { ok: false, error: 'VLESS thiếu UUID hoặc định dạng UUID không hợp lệ' };
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'VLESS thiếu host hoặc port không hợp lệ' };
  }

  const extra: Record<string, string> = {
    uuid,
    network: parsed.searchParams.get('type') ?? 'tcp',
    tls: parsed.searchParams.get('security') ?? 'none',
    sni: parsed.searchParams.get('sni') ?? '',
    path: parsed.searchParams.get('path') ?? '',
    flow: parsed.searchParams.get('flow') ?? '',
  };

  return {
    ok: true,
    hostIpVersion: classifyHost(host),
    proxy: {
      type: 'vless',
      host,
      port,
      username: '',
      password: '',
      extra,
    },
  };
}

function parseTrojan(trimmed: string): ParseProxyOutcome {
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'URL Trojan (trojan://) không hợp lệ' };
  }
  const password = decodeURIComponent(parsed.username);
  const host = parsed.hostname.replace(/^\[|\]$/g, '').trim();
  const port = Number(parsed.port);

  if (!password) {
    return { ok: false, error: 'Trojan thiếu mật khẩu xác thực' };
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Trojan thiếu host hoặc port không hợp lệ' };
  }

  const extra: Record<string, string> = {
    network: parsed.searchParams.get('type') ?? 'tcp',
    tls: parsed.searchParams.get('security') ?? 'tls',
    sni: parsed.searchParams.get('sni') ?? host,
    path: parsed.searchParams.get('path') ?? '',
  };

  return {
    ok: true,
    hostIpVersion: classifyHost(host),
    proxy: {
      type: 'trojan',
      host,
      port,
      username: '',
      password,
      extra,
    },
  };
}

export function parseProxy(
  raw: string,
  defaultType: Exclude<ProxyType, 'none'> = 'http',
): ParseProxyOutcome {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Chuỗi proxy trống' };
  }

  // External core schemes
  if (/^ss:\/\//i.test(trimmed)) return parseShadowsocks(trimmed);
  if (/^vmess:\/\//i.test(trimmed)) return parseVmess(trimmed);
  if (/^vless:\/\//i.test(trimmed)) return parseVless(trimmed);
  if (/^trojan:\/\//i.test(trimmed)) return parseTrojan(trimmed);

  // Reject unknown URL schemes (e.g. ftp://)
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) &&
    !/^(https?|socks4a?|socks5h?|ssh):\/\//i.test(trimmed)
  ) {
    return {
      ok: false,
      error:
        'Giao thức proxy không được hỗ trợ (hỗ trợ: http, https, socks4, socks4a, socks5, socks5h, ssh, ss, vmess, vless, trojan)',
    };
  }

  if (looksLikeUnbracketedIpv6(trimmed)) {
    return { ok: false, error: IPV6_BRACKET_HINT };
  }

  // 1. Standard URL format: scheme://[user:pass@]([ipv6]|ipv4|hostname):port
  const urlMatch =
    /^(https?|socks4a?|socks5h?|ssh):\/\/(?:([^:@\s]+)(?::([^@\s]*))?@)?(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/i.exec(
      trimmed,
    );
  if (urlMatch) {
    const typeRaw = (urlMatch[1] ?? defaultType).toLowerCase() as Exclude<ProxyType, 'none'>;
    const bracketedHost = urlMatch[4];
    const plainHost = urlMatch[5];
    const host = (bracketedHost ?? plainHost ?? '').trim();
    const port = Number(urlMatch[6]);

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Host hoặc port proxy không hợp lệ' };
    }
    if (bracketedHost && net.isIP(bracketedHost) !== 6) {
      return { ok: false, error: 'Địa chỉ IPv6 trong ngoặc vuông không hợp lệ' };
    }

    return {
      ok: true,
      hostIpVersion: classifyHost(host),
      proxy: {
        type: typeRaw,
        host,
        port,
        username: decodeURIComponent(urlMatch[2] ?? ''),
        password: decodeURIComponent(urlMatch[3] ?? ''),
      },
    };
  }

  // 1b. Auth without scheme: user:pass@([ipv6]|ipv4|hostname):port
  const authNoSchemeMatch =
    /^([^:@\s]+):([^@\s]*)@(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/.exec(trimmed);
  if (authNoSchemeMatch) {
    const bracketedHost = authNoSchemeMatch[3];
    const plainHost = authNoSchemeMatch[4];
    const host = (bracketedHost ?? plainHost ?? '').trim();
    const port = Number(authNoSchemeMatch[5]);

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Host hoặc port proxy không hợp lệ' };
    }
    if (bracketedHost && net.isIP(bracketedHost) !== 6) {
      return { ok: false, error: 'Địa chỉ IPv6 trong ngoặc vuông không hợp lệ' };
    }

    return {
      ok: true,
      hostIpVersion: classifyHost(host),
      proxy: {
        type: defaultType,
        host,
        port,
        username: decodeURIComponent(authNoSchemeMatch[1] ?? ''),
        password: decodeURIComponent(authNoSchemeMatch[2] ?? ''),
      },
    };
  }

  // 2. Bracketed IPv6 without scheme: [::1]:8080 or [::1]:8080:user:pass
  const bracketMatch = /^\[([^\]]+)\]:(\d+)(?::([^:]*):(.*))?$/.exec(trimmed);
  if (bracketMatch) {
    const host = (bracketMatch[1] ?? '').trim();
    const port = Number(bracketMatch[2]);
    if (net.isIP(host) !== 6) {
      return { ok: false, error: 'Địa chỉ IPv6 trong ngoặc vuông không hợp lệ' };
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'Port proxy phải từ 1 đến 65535' };
    }
    return {
      ok: true,
      hostIpVersion: 6,
      proxy: {
        type: defaultType,
        host,
        port,
        username: bracketMatch[3] ?? '',
        password: bracketMatch[4] ?? '',
      },
    };
  }

  // 3. Colon format for IPv4 / hostname: host:port or host:port:user:pass
  const parts = trimmed.split(':');
  if (parts.length === 2 || parts.length >= 4) {
    const host = (parts[0] ?? '').trim();
    const port = Number((parts[1] ?? '').trim());
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
      hostIpVersion: classifyHost(host),
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

export function formatHostForUrl(host: string): string {
  const clean = host.trim().replace(/^\[|\]$/g, '');
  return net.isIP(clean) === 6 ? `[${clean}]` : clean;
}
