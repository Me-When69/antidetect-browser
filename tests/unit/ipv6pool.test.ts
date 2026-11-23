import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateRandomIpv6InPrefix64,
  isAddressInPrefix64,
  isGlobalUnicast2000,
  parseIpv6ToBigInt,
  parsePrefix64,
  verifyPrefixRouting,
} from '../../electron/services/ipv6pool/prefix';
import {
  Ipv6AddressManager,
  validateAddressBatch,
  validateInterfaceName,
  type CommandRunner,
} from '../../electron/services/ipv6pool/addressManager';
import {
  Ipv6PoolService,
  MIN_AUTO_ROTATE_MINUTES,
} from '../../electron/services/ipv6pool/ipv6PoolService';
import { createDatabase } from '../../electron/db';
import { AppLogger } from '../../electron/services/logger';

// RFC 3849 documentation prefix ONLY (never real prefixes)
const DOC_PREFIX = '2001:db8:abcd:1::/64';

function createMockRunner(assignedOnHost = new Set<string>()): {
  runner: CommandRunner;
  elevatedCalls: string[][][];
} {
  const elevatedCalls: string[][][] = [];
  const runner: CommandRunner = {
    execNetsh: async () => {
      const lines = [
        'Interface 12: Ethernet',
        'Addr Type  DAD State   Valid Life Pref. Life Address',
        '---------  ----------- ---------- ---------- ------------------------',
      ];
      for (const addr of assignedOnHost) {
        lines.push(`Manual     Preferred     infinite   infinite ${addr}`);
      }
      return { stdout: lines.join('\r\n'), stderr: '', exitCode: 0 };
    },
    execElevatedNetshBatch: async (argLists) => {
      elevatedCalls.push(argLists.map((a) => [...a]));
      for (const args of argLists) {
        if (args[2] === 'add' && args[5]) {
          assignedOnHost.add(args[5].replace(/\/64$/, ''));
        } else if (args[2] === 'delete' && args[5]) {
          assignedOnHost.delete(args[5]);
        }
      }
      return { exitCode: 0 };
    },
  };
  return { runner, elevatedCalls };
}

describe('Local IPv6 Pool Unit Tests (RFC 3849 2001:db8::/32)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      try {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows handle locks
      }
    }
  });

  it('accepts only 2000::/3 /64 prefixes and rejects link-local, ULA, loopback, and non-/64', () => {
    const parsed = parsePrefix64('2001:0db8:abcd:0001::1234/64');
    expect(parsed.canonical).toBe('2001:db8:abcd:1::/64');

    expect(isGlobalUnicast2000('2001:db8::1')).toBe(true);
    expect(isGlobalUnicast2000('fe80::1')).toBe(false);
    expect(isGlobalUnicast2000('fc00::1')).toBe(false);
    expect(isGlobalUnicast2000('fd12:3456::1')).toBe(false);
    expect(isGlobalUnicast2000('::1')).toBe(false);
    expect(isGlobalUnicast2000('ff02::1')).toBe(false);

    expect(() => parsePrefix64('fe80::/64')).toThrow();
    expect(() => parsePrefix64('fd00:1234::/64')).toThrow();
    expect(() => parsePrefix64('fc00::/64')).toThrow();
    expect(() => parsePrefix64('::1/64')).toThrow();
    expect(() => parsePrefix64('2001:db8:abcd::/48')).toThrow();
    expect(() => parsePrefix64('2001:db8:abcd:1::1/128')).toThrow();
    expect(() => parsePrefix64('2001:db8:abcd:1::')).toThrow();
  });

  it('generates unique random IPv6 addresses inside /64 avoiding special & host addresses', () => {
    const hostAddrs = new Set<string>(['2001:db8:abcd:1::42']);
    const generated = new Set<string>();

    for (let i = 0; i < 60; i += 1) {
      const addr = generateRandomIpv6InPrefix64(DOC_PREFIX, new Set([...hostAddrs, ...generated]));
      expect(isAddressInPrefix64(addr, DOC_PREFIX)).toBe(true);
      expect(hostAddrs.has(addr)).toBe(false);
      expect(generated.has(addr)).toBe(false);

      const iid = parseIpv6ToBigInt(addr) & ((1n << 64n) - 1n);
      expect(iid).not.toBe(0n);
      expect(iid).not.toBe(1n);
      generated.add(addr);
    }
    expect(generated.size).toBe(60);
  });

  it('strictly validates command parameters and rejects injection, out-of-prefix, and over-limit batches', () => {
    expect(validateInterfaceName('Ethernet 2')).toBe('Ethernet 2');
    expect(validateInterfaceName('Wi-Fi')).toBe('Wi-Fi');

    // Command injection characters MUST be rejected
    expect(() => validateInterfaceName('Ethernet; calc.exe')).toThrow();
    expect(() => validateInterfaceName('Ethernet && dir')).toThrow();
    expect(() => validateInterfaceName('Ethernet | whoami')).toThrow();
    expect(() => validateInterfaceName('Ethernet$(id)')).toThrow();
    expect(() => validateInterfaceName('Ethernet`echo hi`')).toThrow();
    expect(() => validateInterfaceName('Ethernet"test')).toThrow();
    expect(() => validateInterfaceName("Ethernet'test")).toThrow();
    expect(() => validateInterfaceName('Ethernet\nadd')).toThrow();

    // Out-of-prefix address MUST be rejected
    expect(() => validateAddressBatch(['2001:db8:9999:1::5'], DOC_PREFIX, 10)).toThrow();

    // Over-limit batch MUST be rejected
    const threeAddrs = ['2001:db8:abcd:1::10', '2001:db8:abcd:1::11', '2001:db8:abcd:1::12'];
    expect(() => validateAddressBatch(threeAddrs, DOC_PREFIX, 2)).toThrow();
    expect(validateAddressBatch(threeAddrs, DOC_PREFIX, 3)).toHaveLength(3);
  });

  it('detects ONLY app-assigned orphan addresses and ignores host/system IPv6 addresses', async () => {
    const hostSet = new Set<string>([
      '2001:db8:abcd:1::1', // host's own IP (NOT assigned by app)
      '2001:db8:abcd:1::aaaa', // orphan left by app
      '2001:db8:abcd:1::bbbb', // orphan left by app
    ]);
    const { runner } = createMockRunner(hostSet);
    const manager = new Ipv6AddressManager(runner, { dadPollIntervalMs: 5, dadTimeoutMs: 200 });

    const dbAssigned = ['2001:db8:abcd:1::aaaa', '2001:db8:abcd:1::cccc'];
    const orphans = await manager.detectOrphanAddresses('Ethernet', dbAssigned);

    expect(orphans).toEqual(['2001:db8:abcd:1::aaaa']);
    expect(orphans).not.toContain('2001:db8:abcd:1::1');
  });

  it('verifies routing by assigning 1 test address, checking echo match, and always cleaning up', async () => {
    const assigned: string[] = [];
    const removed: string[] = [];

    const okRes = await verifyPrefixRouting('Ethernet', DOC_PREFIX, ['https://echo.test'], {
      assignTestAddress: async (_iface, addr) => {
        assigned.push(addr);
      },
      removeTestAddress: async (_iface, addr) => {
        removed.push(addr);
      },
      fetchEcho: async (_ep, localAddr) => localAddr,
    });
    expect(okRes.ok).toBe(true);
    expect(assigned).toHaveLength(1);
    expect(removed).toEqual(assigned);

    // Mismatch case (ISP single-IP NAT) -> ok: false + Vietnamese guidance + still removes test addr
    const failRes = await verifyPrefixRouting('Ethernet', DOC_PREFIX, ['https://echo.test'], {
      assignTestAddress: async (_iface, addr) => {
        assigned.push(addr);
      },
      removeTestAddress: async (_iface, addr) => {
        removed.push(addr);
      },
      fetchEcho: async () => '2001:db8:abcd:1::9999',
    });
    expect(failRes.ok).toBe(false);
    expect(failRes.guidance).toContain('/64');
    expect(removed).toHaveLength(2);
  });

  it('persists fixed profileId -> IPv6 mapping across calls and enforces minimum 10-minute auto-rotation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-ipv6-unit-'));
    tempDirs.push(dir);
    const dbCtx = createDatabase(path.join(dir, 'antidetect.db'));
    const hostSet = new Set<string>();
    const { runner } = createMockRunner(hostSet);
    const manager = new Ipv6AddressManager(runner, { dadPollIntervalMs: 5, dadTimeoutMs: 200 });
    const logger = new AppLogger();

    const service = new Ipv6PoolService(dbCtx.db, logger, {
      addressManager: manager,
      fetchEcho: async (_ep, localAddr) => localAddr,
    });

    // Auto-rotate must be OFF by default and clamped to >= 10 minutes
    expect(service.getConfig().autoRotateEnabled).toBe(false);
    const cfg = service.updateConfig({
      interfaceName: 'Ethernet',
      prefix64: DOC_PREFIX,
      ownershipConfirmed: true,
      autoRotateEnabled: true,
      autoRotateIntervalMinutes: 2, // attempt < 10 min
    });
    expect(cfg.autoRotateIntervalMinutes).toBe(MIN_AUTO_ROTATE_MINUTES);

    const routing = await service.verifyRouting();
    expect(routing.ok).toBe(true);

    // Fixed profile -> IPv6 mapping across repeated resolutions
    const first = await service.resolveProxyForProfile('profile-1');
    const second = await service.resolveProxyForProfile('profile-1');
    expect(first.address).toBe(second.address);
    expect(first.proxy.host).toBe('127.0.0.1');

    // Scheduled rotation cooldown enforcement (< 10 min throws)
    const t0 = Date.now();
    await service.runScheduledRotation(t0);
    await expect(service.runScheduledRotation(t0 + 5 * 60 * 1000)).rejects.toThrow(/10 phút/);

    // Cleanup removes ONLY app-assigned addresses
    await service.shutdown();
    expect(hostSet.size).toBe(0);
    dbCtx.sqlite.close();
  });
});
