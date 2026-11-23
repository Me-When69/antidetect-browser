import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import type { Ipv6RoutingCheckResult, NetworkInterfaceIpv6Info } from '@shared/ipv6Types';

export const DEFAULT_IPV6_ECHO_ENDPOINTS: readonly string[] = [
  'https://api6.ipify.org',
  'https://ipv6.icanhazip.com',
  'https://ifconfig.co/ip',
];

const MASK_128 = (1n << 128n) - 1n;
const MASK_64 = (1n << 64n) - 1n;
const GLOBAL_UNICAST_MIN = 0x2000n << 112n; // 2000::
const GLOBAL_UNICAST_MAX = (0x4000n << 112n) - 1n; // 3fff:ffff:...:ffff

/**
 * Parse a valid IPv6 address string (without zone index or /prefix) into a 128-bit BigInt.
 * Throws if invalid.
 */
export function parseIpv6ToBigInt(raw: string): bigint {
  const clean = raw.trim().replace(/^\[|\]$/g, '');
  if (!clean || clean.includes('%') || clean.includes('/')) {
    throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
  }
  if (net.isIPv6(clean) === false) {
    throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
  }

  // Handle embedded IPv4 suffix if present (e.g. ::ffff:192.0.2.1)
  let working = clean;
  const lastColon = working.lastIndexOf(':');
  if (working.includes('.') && lastColon !== -1) {
    const ipv4Part = working.slice(lastColon + 1);
    const octets = ipv4Part.split('.').map((n) => Number(n));
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
    }
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const parts = working.split('::');
  if (parts.length > 2) {
    throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
  }

  const left = parts[0] ? parts[0].split(':').filter((s) => s.length > 0) : [];
  const right =
    parts.length === 2 && parts[1] ? parts[1].split(':').filter((s) => s.length > 0) : [];

  const totalGroups = left.length + right.length;
  if (parts.length === 1 && totalGroups !== 8) {
    throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
  }
  if (parts.length === 2 && totalGroups > 7) {
    throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
  }

  const missing = 8 - totalGroups;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  let result = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) {
      throw new Error(`Địa chỉ IPv6 không hợp lệ: ${raw}`);
    }
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result & MASK_128;
}

/**
 * Format a 128-bit BigInt into canonical compressed lowercase IPv6 string (RFC 5952).
 */
export function bigIntToIpv6(value: bigint): string {
  const v = value & MASK_128;
  const groups: number[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    groups.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  }

  // Find longest run of >= 2 consecutive zeros
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen += 1;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen < 2) {
    return groups.map((g) => g.toString(16)).join(':');
  }

  const left = groups
    .slice(0, bestStart)
    .map((g) => g.toString(16))
    .join(':');
  const right = groups
    .slice(bestStart + bestLen)
    .map((g) => g.toString(16))
    .join(':');
  return `${left}::${right}`;
}

export function normalizeIpv6(raw: string): string {
  return bigIntToIpv6(parseIpv6ToBigInt(raw));
}

/**
 * Returns true ONLY if the IPv6 address is Global Unicast (2000::/3).
 * Excludes link-local (fe80::/10), ULA (fc00::/7), loopback (::1), multicast (ff00::/8), etc.
 */
export function isGlobalUnicast2000(raw: string): boolean {
  try {
    const v = parseIpv6ToBigInt(raw);
    return v >= GLOBAL_UNICAST_MIN && v <= GLOBAL_UNICAST_MAX;
  } catch {
    return false;
  }
}

export interface ParsedPrefix64 {
  canonical: string;
  networkBigInt: bigint;
  prefixLen: 64;
}

/**
 * Validate and canonicalize a /64 Global Unicast (2000::/3) IPv6 prefix.
 */
export function parsePrefix64(raw: string): ParsedPrefix64 {
  const trimmed = raw.trim();
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) {
    throw new Error('Tiền tố phải có dạng <ipv6>/64 (ví dụ 2001:db8:abcd:1::/64)');
  }
  const addrPart = trimmed.slice(0, slashIdx).trim();
  const lenPart = trimmed.slice(slashIdx + 1).trim();
  if (lenPart !== '64') {
    throw new Error('Chỉ hỗ trợ tiền tố độ dài đúng /64');
  }

  const addrVal = parseIpv6ToBigInt(addrPart);
  if (addrVal < GLOBAL_UNICAST_MIN || addrVal > GLOBAL_UNICAST_MAX) {
    throw new Error(
      'Tiền tố phải thuộc dải Unicast toàn cục 2000::/3 (không chấp nhận link-local fe80::, ULA fc00::/fd00::, loopback ::1)',
    );
  }

  const networkBigInt = addrVal & (MASK_64 << 64n);
  return {
    canonical: `${bigIntToIpv6(networkBigInt)}/64`,
    networkBigInt,
    prefixLen: 64,
  };
}

export function isAddressInPrefix64(address: string, prefix64: string): boolean {
  try {
    const parsedPrefix = parsePrefix64(prefix64);
    const addrVal = parseIpv6ToBigInt(address);
    return (addrVal & (MASK_64 << 64n)) === parsedPrefix.networkBigInt;
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random IPv6 address inside a validated /64 prefix.
 * Avoids:
 * - subnet-router anycast (::0)
 * - ::1 (common gateway)
 * - reserved subnet anycast range (fdff:ffff:ffff:ff80..ffff)
 * - any address in `excludeSet` (existing pool addresses + host interface addresses)
 */
export function generateRandomIpv6InPrefix64(
  prefix64: string,
  excludeSet: ReadonlySet<string> = new Set(),
  maxAttempts = 1000,
): string {
  const parsed = parsePrefix64(prefix64);
  const normalizedExcludes = new Set<string>();
  for (const ex of excludeSet) {
    try {
      normalizedExcludes.add(normalizeIpv6(ex));
    } catch {
      // Ignore invalid entries in excludeSet
    }
  }

  const RESERVED_ANYCAST_START = 0xfdffffff_ffffff80n;
  const RESERVED_ANYCAST_END = 0xfdffffff_ffffffffn;

  for (let i = 0; i < maxAttempts; i += 1) {
    const randBuf = crypto.randomBytes(8);
    const iid = randBuf.readBigUInt64BE(0);
    // Avoid ::0 (subnet-router anycast), ::1 (gateway), and RFC 2526 reserved subnet anycast
    if (iid === 0n || iid === 1n) continue;
    if (iid >= RESERVED_ANYCAST_START && iid <= RESERVED_ANYCAST_END) continue;

    const candidate = bigIntToIpv6(parsed.networkBigInt | iid);
    if (!normalizedExcludes.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Không thể sinh địa chỉ IPv6 ngẫu nhiên không trùng sau nhiều lần thử');
}

/**
 * List network interfaces that have at least one Global Unicast (2000::/3) IPv6 address,
 * plus any non-internal interfaces (so user can still enter a manual /64 prefix).
 */
export function listIpv6Interfaces(
  networkInterfacesFn: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces,
): NetworkInterfaceIpv6Info[] {
  const map = networkInterfacesFn();
  const result: NetworkInterfaceIpv6Info[] = [];

  for (const [name, infos] of Object.entries(map)) {
    if (!infos || infos.length === 0) continue;
    // Skip loopback-only interfaces
    if (infos.every((i) => i.internal)) continue;

    const globalAddrs: string[] = [];
    const prefixes = new Set<string>();

    for (const info of infos) {
      if (info.family !== 'IPv6' || info.internal) continue;
      const addrClean = info.address.split('%')[0] ?? '';
      if (!isGlobalUnicast2000(addrClean)) continue;
      const norm = normalizeIpv6(addrClean);
      globalAddrs.push(norm);
      const netVal = parseIpv6ToBigInt(norm) & (MASK_64 << 64n);
      prefixes.add(`${bigIntToIpv6(netVal)}/64`);
    }

    result.push({
      name,
      addresses: globalAddrs,
      suggestedPrefixes: Array.from(prefixes),
    });
  }

  // Sort interfaces with global IPv6 addresses first
  result.sort((a, b) => b.addresses.length - a.addresses.length || a.name.localeCompare(b.name));
  return result;
}

/**
 * Collect all currently configured IPv6 addresses across all host interfaces.
 */
export function getAllHostIpv6Addresses(
  networkInterfacesFn: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces,
): Set<string> {
  const out = new Set<string>();
  const map = networkInterfacesFn();
  for (const infos of Object.values(map)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family !== 'IPv6') continue;
      const addrClean = info.address.split('%')[0] ?? '';
      try {
        out.add(normalizeIpv6(addrClean));
      } catch {
        // Ignore
      }
    }
  }
  return out;
}

/**
 * Fetch the echoed client IPv6 address from an echo endpoint using a socket bound
 * strictly to `localAddress` with `family: 6`.
 */
export function fetchEchoIpv6(
  endpointUrl: string,
  localAddress: string,
  timeoutMs = 8000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const parsedUrl = new URL(endpointUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;

    const req = mod.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : isHttps ? 443 : 80,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        family: 6,
        localAddress,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Facet-IPv6-Check/1.0',
          Accept: 'text/plain',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          try {
            resolve(normalizeIpv6(raw));
          } catch {
            reject(new Error(`Phản hồi không phải IPv6 hợp lệ: ${raw.slice(0, 64)}`));
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Hết thời gian chờ kết nối IPv6'));
    });
    req.on('error', (err) => {
      reject(err);
    });
    req.end();
  });
}

export interface RoutingCheckDeps {
  assignTestAddress: (interfaceName: string, address: string) => Promise<void>;
  removeTestAddress: (interfaceName: string, address: string) => Promise<void>;
  fetchEcho?: (endpointUrl: string, localAddress: string, timeoutMs?: number) => Promise<string>;
  existingAddresses?: ReadonlySet<string>;
}

const ROUTING_FAILURE_GUIDANCE =
  'Tiền tố /64 chưa định tuyến đầy đủ về máy bạn. Nhà cung cấp VPS có thể chưa định tuyến cả dải /64 (hoặc cần cấu hình NDP/định tuyến trong bảng điều khiển), hoặc mạng nhà ISP chỉ cấp một địa chỉ IPv6 đơn lẻ.';

/**
 * Mandatory routing check before bulk pool allocation:
 * 1. Generates ONE test IPv6 address inside prefix64.
 * 2. Assigns it temporarily to interfaceName.
 * 3. Connects to fallback IPv6 echo endpoints bound to localAddress.
 * 4. Compares echoed IP === test IP.
 * 5. Always removes the test address in finally.
 */
export async function verifyPrefixRouting(
  interfaceName: string,
  prefix64: string,
  endpoints: readonly string[] = DEFAULT_IPV6_ECHO_ENDPOINTS,
  deps: RoutingCheckDeps,
): Promise<Ipv6RoutingCheckResult> {
  const parsed = parsePrefix64(prefix64);
  const testAddress = generateRandomIpv6InPrefix64(
    parsed.canonical,
    deps.existingAddresses ?? getAllHostIpv6Addresses(),
  );
  const echoFn = deps.fetchEcho ?? fetchEchoIpv6;
  const activeEndpoints = endpoints.length > 0 ? endpoints : DEFAULT_IPV6_ECHO_ENDPOINTS;

  await deps.assignTestAddress(interfaceName, testAddress);

  let echoedAddress: string | null = null;
  let endpointUsed: string | null = null;
  let lastErr = '';

  try {
    for (const ep of activeEndpoints) {
      try {
        const echoed = await echoFn(ep, testAddress, 8000);
        echoedAddress = echoed;
        endpointUsed = ep;
        if (echoed === testAddress) {
          return {
            ok: true,
            testedAddress: testAddress,
            echoedAddress: echoed,
            endpointUsed: ep,
          };
        }
        // Echoed a DIFFERENT IPv6 -> provider NAT/single-IP, stop immediately
        return {
          ok: false,
          testedAddress: testAddress,
          echoedAddress: echoed,
          endpointUsed: ep,
          error: `Địa chỉ đi ra thực tế (${echoed}) không khớp địa chỉ thử (${testAddress})`,
          guidance: ROUTING_FAILURE_GUIDANCE,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      ok: false,
      testedAddress: testAddress,
      echoedAddress,
      endpointUsed,
      error: `Không thể kết nối ra ngoài qua địa chỉ thử ${testAddress}: ${lastErr || 'Không có phản hồi'}`,
      guidance: ROUTING_FAILURE_GUIDANCE,
    };
  } finally {
    try {
      await deps.removeTestAddress(interfaceName, testAddress);
    } catch {
      // Best-effort cleanup of test address
    }
  }
}
