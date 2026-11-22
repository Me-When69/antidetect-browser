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

function looksLikeUnbracketedIpv6(input: string): boolean {
  const withoutScheme = input.replace(/^(https?|socks5):\/\//i, '');
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
  // If stripping the last :port leaves a valid IPv6 address, or the whole string is IPv6
  if (net.isIP(hostPart) === 6) {
    return true;
  }
  const lastColon = hostPart.lastIndexOf(':');
  if (lastColon > 0) {
    const candidate = hostPart.slice(0, lastColon);
    if (net.isIP(candidate) === 6) {
      return true;
    }
  }
  return hostPart.includes('::');
}

function classifyHost(host: string): 0 | 4 | 6 {
  const v = net.isIP(host);
  return v === 4 ? 4 : v === 6 ? 6 : 0;
}

export function parseProxy(
  raw: string,
  defaultType: Exclude<ProxyType, 'none'> = 'http',
): ParseProxyOutcome {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Chuỗi proxy trống' };
  }

  if (looksLikeUnbracketedIpv6(trimmed)) {
    return { ok: false, error: IPV6_BRACKET_HINT };
  }

  // 1. URL format: scheme://[user:pass@]([ipv6]|ipv4|hostname):port
  const urlMatch =
    /^(https?|socks5):\/\/(?:([^:@\s]+):([^@\s]*)@)?(?:\[([^\]]+)\]|([^:/\s]+)):(\d+)$/i.exec(
      trimmed,
    );
  if (urlMatch) {
    const typeRaw = (urlMatch[1] ?? defaultType).toLowerCase();
    const type: Exclude<ProxyType, 'none'> =
      typeRaw === 'https' || typeRaw === 'socks5' ? typeRaw : 'http';
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
        type,
        host,
        port,
        username: decodeURIComponent(urlMatch[2] ?? ''),
        password: decodeURIComponent(urlMatch[3] ?? ''),
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
