import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db';
import { ipv6PoolTable, profilesTable, settingsTable } from '../../db/schema';
import type { ProfileProxy } from '@shared/types';
import type {
  Ipv6AddressHealth,
  Ipv6PoolConfig,
  Ipv6PoolEntrySummary,
  Ipv6PoolStatus,
  Ipv6RoutingCheckResult,
  NetworkInterfaceIpv6Info,
} from '@shared/ipv6Types';
import {
  DEFAULT_IPV6_ECHO_ENDPOINTS,
  fetchEchoIpv6,
  generateRandomIpv6InPrefix64,
  getAllHostIpv6Addresses,
  listIpv6Interfaces,
  normalizeIpv6,
  parsePrefix64,
  verifyPrefixRouting,
} from './prefix';
import {
  DEFAULT_MAX_ADDRESSES,
  HARD_MAX_ADDRESSES,
  Ipv6AddressManager,
  validateInterfaceName,
} from './addressManager';
import {
  DEFAULT_MAX_CONCURRENT_PER_LISTENER,
  Ipv6EgressManager,
  type EgressManagerOptions,
} from './egress';
import type { AppLogger } from '../logger';

export const MIN_AUTO_ROTATE_MINUTES = 10;
const CONFIG_SETTINGS_KEY = 'ipv6_pool_config';

const DEFAULT_CONFIG: Ipv6PoolConfig = {
  interfaceName: '',
  prefix64: '',
  ownershipConfirmed: false,
  ownershipConfirmedAt: null,
  routingVerified: false,
  routingVerifiedAt: null,
  maxAddresses: DEFAULT_MAX_ADDRESSES,
  maxConcurrentPerListener: DEFAULT_MAX_CONCURRENT_PER_LISTENER,
  echoEndpoints: [...DEFAULT_IPV6_ECHO_ENDPOINTS],
  autoRotateEnabled: false,
  autoRotateIntervalMinutes: MIN_AUTO_ROTATE_MINUTES,
};

export interface Ipv6PoolServiceOptions {
  addressManager?: Ipv6AddressManager;
  egressOptions?: EgressManagerOptions;
  fetchEcho?: (endpointUrl: string, localAddress: string, timeoutMs?: number) => Promise<string>;
  onProfileKillSwitch?: (profileId: string, reason: string) => void;
  onStatsBatch?: (counts: Record<string, number>) => void;
  isProfileRunning?: (profileId: string) => boolean;
}

export class Ipv6PoolService {
  private db: AppDatabase;
  private logger: AppLogger;
  private addressManager: Ipv6AddressManager;
  private egressManager: Ipv6EgressManager;
  private fetchEchoFn: (
    endpointUrl: string,
    localAddress: string,
    timeoutMs?: number,
  ) => Promise<string>;
  private onProfileKillSwitch?: (profileId: string, reason: string) => void;
  private isProfileRunningFn?: (profileId: string) => boolean;
  private orphanAddresses: string[] = [];
  private autoRotateTimer: ReturnType<typeof setInterval> | null = null;
  private lastAutoRotateAtMs = 0;

  constructor(db: AppDatabase, logger: AppLogger, options: Ipv6PoolServiceOptions = {}) {
    this.db = db;
    this.logger = logger;
    this.addressManager = options.addressManager ?? new Ipv6AddressManager();
    this.fetchEchoFn = options.fetchEcho ?? fetchEchoIpv6;
    this.onProfileKillSwitch = options.onProfileKillSwitch;
    this.isProfileRunningFn = options.isProfileRunning;

    const cfg = this.getConfig();
    this.egressManager = new Ipv6EgressManager({
      ...options.egressOptions,
      maxConcurrentPerListener: cfg.maxConcurrentPerListener,
      onStatsBatch: options.onStatsBatch,
      onListenerDead: (egressIpv6, errorCode) => {
        this.logger.warn('ipv6pool', `Listener stopped for ${egressIpv6} (code=${errorCode})`);
        const row = this.db
          .select()
          .from(ipv6PoolTable)
          .where(eq(ipv6PoolTable.address, egressIpv6))
          .get();
        if (row?.profileId) {
          this.onProfileKillSwitch?.(
            row.profileId,
            `Kill switch IPv6 kích hoạt (${errorCode}): địa chỉ đi ra không còn khả dụng, hồ sơ đã được đóng an toàn để tránh rò IP thật.`,
          );
        }
      },
    });
  }

  getConfig(): Ipv6PoolConfig {
    const row = this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, CONFIG_SETTINGS_KEY))
      .get();
    if (!row) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(row.value) as Partial<Ipv6PoolConfig>;
      return {
        interfaceName: typeof parsed.interfaceName === 'string' ? parsed.interfaceName : '',
        prefix64: typeof parsed.prefix64 === 'string' ? parsed.prefix64 : '',
        ownershipConfirmed: Boolean(parsed.ownershipConfirmed),
        ownershipConfirmedAt: parsed.ownershipConfirmedAt ?? null,
        routingVerified: Boolean(parsed.routingVerified),
        routingVerifiedAt: parsed.routingVerifiedAt ?? null,
        maxAddresses: Math.max(
          1,
          Math.min(HARD_MAX_ADDRESSES, Math.floor(parsed.maxAddresses ?? DEFAULT_MAX_ADDRESSES)),
        ),
        maxConcurrentPerListener: Math.max(
          1,
          Math.min(
            2000,
            Math.floor(parsed.maxConcurrentPerListener ?? DEFAULT_MAX_CONCURRENT_PER_LISTENER),
          ),
        ),
        echoEndpoints:
          Array.isArray(parsed.echoEndpoints) && parsed.echoEndpoints.length > 0
            ? parsed.echoEndpoints.filter((u): u is string => typeof u === 'string' && u.length > 0)
            : [...DEFAULT_IPV6_ECHO_ENDPOINTS],
        autoRotateEnabled: Boolean(parsed.autoRotateEnabled),
        autoRotateIntervalMinutes: Math.max(
          MIN_AUTO_ROTATE_MINUTES,
          Math.floor(parsed.autoRotateIntervalMinutes ?? MIN_AUTO_ROTATE_MINUTES),
        ),
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private saveConfig(cfg: Ipv6PoolConfig): void {
    this.db
      .insert(settingsTable)
      .values({ key: CONFIG_SETTINGS_KEY, value: JSON.stringify(cfg) })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: JSON.stringify(cfg) },
      })
      .run();
  }

  updateConfig(patch: Partial<Ipv6PoolConfig>): Ipv6PoolConfig {
    const current = this.getConfig();
    let nextIface = current.interfaceName;
    if (patch.interfaceName !== undefined) {
      nextIface = patch.interfaceName.trim() ? validateInterfaceName(patch.interfaceName) : '';
    }

    let nextPrefix = current.prefix64;
    if (patch.prefix64 !== undefined) {
      nextPrefix = patch.prefix64.trim() ? parsePrefix64(patch.prefix64).canonical : '';
    }

    const prefixOrIfaceChanged =
      nextIface !== current.interfaceName || nextPrefix !== current.prefix64;

    const nextOwnership =
      patch.ownershipConfirmed !== undefined
        ? Boolean(patch.ownershipConfirmed)
        : prefixOrIfaceChanged
          ? false
          : current.ownershipConfirmed;

    const nextOwnershipAt =
      nextOwnership && !current.ownershipConfirmed
        ? new Date().toISOString()
        : nextOwnership
          ? current.ownershipConfirmedAt
          : null;

    const nextAutoInterval =
      patch.autoRotateIntervalMinutes !== undefined
        ? Math.max(MIN_AUTO_ROTATE_MINUTES, Math.floor(patch.autoRotateIntervalMinutes))
        : current.autoRotateIntervalMinutes;

    const next: Ipv6PoolConfig = {
      interfaceName: nextIface,
      prefix64: nextPrefix,
      ownershipConfirmed: nextOwnership,
      ownershipConfirmedAt: nextOwnershipAt,
      routingVerified: prefixOrIfaceChanged ? false : current.routingVerified,
      routingVerifiedAt: prefixOrIfaceChanged ? null : current.routingVerifiedAt,
      maxAddresses:
        patch.maxAddresses !== undefined
          ? Math.max(1, Math.min(HARD_MAX_ADDRESSES, Math.floor(patch.maxAddresses)))
          : current.maxAddresses,
      maxConcurrentPerListener:
        patch.maxConcurrentPerListener !== undefined
          ? Math.max(1, Math.min(2000, Math.floor(patch.maxConcurrentPerListener)))
          : current.maxConcurrentPerListener,
      echoEndpoints:
        patch.echoEndpoints && patch.echoEndpoints.length > 0
          ? patch.echoEndpoints
          : current.echoEndpoints,
      autoRotateEnabled:
        patch.autoRotateEnabled !== undefined
          ? Boolean(patch.autoRotateEnabled)
          : current.autoRotateEnabled,
      autoRotateIntervalMinutes: nextAutoInterval,
    };

    this.saveConfig(next);
    this.syncAutoRotateTimer(next);
    return next;
  }

  private syncAutoRotateTimer(cfg: Ipv6PoolConfig): void {
    if (this.autoRotateTimer) {
      clearInterval(this.autoRotateTimer);
      this.autoRotateTimer = null;
    }
    if (!cfg.autoRotateEnabled) return;
    const intervalMs = Math.max(MIN_AUTO_ROTATE_MINUTES, cfg.autoRotateIntervalMinutes) * 60 * 1000;
    this.autoRotateTimer = setInterval(() => {
      void this.runScheduledRotation();
    }, intervalMs);
    if (typeof this.autoRotateTimer.unref === 'function') {
      this.autoRotateTimer.unref();
    }
  }

  async runScheduledRotation(nowMs = Date.now()): Promise<{ rotated: number; skipped: number }> {
    const cfg = this.getConfig();
    if (!cfg.autoRotateEnabled) return { rotated: 0, skipped: 0 };
    const minMs = Math.max(MIN_AUTO_ROTATE_MINUTES, cfg.autoRotateIntervalMinutes) * 60 * 1000;
    if (this.lastAutoRotateAtMs > 0 && nowMs - this.lastAutoRotateAtMs < minMs) {
      throw new Error(
        `Xoay IPv6 theo hẹn giờ yêu cầu tối thiểu ${MIN_AUTO_ROTATE_MINUTES} phút giữa hai lần`,
      );
    }
    this.lastAutoRotateAtMs = nowMs;

    const rows = this.db.select().from(ipv6PoolTable).all();
    let rotated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.profileId) continue;
      if (this.isProfileRunningFn?.(row.profileId)) {
        skipped += 1;
        continue;
      }
      await this.rotateProfileAddress(row.profileId, { forceIfRunning: false });
      rotated += 1;
    }
    return { rotated, skipped };
  }

  listInterfaces(): NetworkInterfaceIpv6Info[] {
    return listIpv6Interfaces();
  }

  getStatus(): Ipv6PoolStatus {
    const config = this.getConfig();
    const rows = this.db.select().from(ipv6PoolTable).all();
    const profiles = this.db
      .select({ id: profilesTable.id, name: profilesTable.name })
      .from(profilesTable)
      .all();
    const profileNameMap = new Map(profiles.map((p) => [p.id, p.name]));
    const orphanSet = new Set(this.orphanAddresses);

    const entries: Ipv6PoolEntrySummary[] = rows.map((r) => {
      const listener = this.egressManager.getListener(r.address);
      return {
        address: r.address,
        interfaceName: r.interfaceName,
        prefix64: r.prefix64,
        profileId: r.profileId ?? null,
        profileName: r.profileId ? (profileNameMap.get(r.profileId) ?? r.profileId) : null,
        listenPort: listener?.isRunning() ? listener.getPort() : null,
        activeConnections: listener?.getActiveConnections() ?? 0,
        health: (r.health as Ipv6AddressHealth) ?? 'unknown',
        lastCheckedAt: r.lastCheckedAt ?? null,
        assignedAt: r.assignedAt,
        isOrphan: orphanSet.has(r.address),
      };
    });

    return {
      supportedPlatform: process.platform === 'win32',
      config,
      entries,
      orphanAddresses: [...this.orphanAddresses],
    };
  }

  async verifyRouting(): Promise<Ipv6RoutingCheckResult> {
    const cfg = this.getConfig();
    if (!cfg.interfaceName || !cfg.prefix64) {
      throw new Error('Vui lòng chọn card mạng (interface) và nhập tiền tố /64 trước');
    }
    if (!cfg.ownershipConfirmed) {
      throw new Error(
        'Bạn phải xác nhận quyền sở hữu hoặc được ủy quyền sử dụng tiền tố này trước',
      );
    }

    const existingRows = this.db
      .select({ address: ipv6PoolTable.address })
      .from(ipv6PoolTable)
      .all();
    const exclude = getAllHostIpv6Addresses();
    for (const r of existingRows) exclude.add(r.address);

    const result = await verifyPrefixRouting(cfg.interfaceName, cfg.prefix64, cfg.echoEndpoints, {
      existingAddresses: exclude,
      fetchEcho: this.fetchEchoFn,
      assignTestAddress: async (iface, addr) => {
        await this.addressManager.assignAddresses(iface, cfg.prefix64, [addr], cfg.maxAddresses);
      },
      removeTestAddress: async (iface, addr) => {
        await this.addressManager.removeAddresses(iface, [addr], cfg.prefix64);
      },
    });

    const nextCfg: Ipv6PoolConfig = {
      ...cfg,
      routingVerified: result.ok,
      routingVerifiedAt: result.ok ? new Date().toISOString() : null,
    };
    this.saveConfig(nextCfg);
    this.logger.info(
      'ipv6pool',
      `Routing check ${result.ok ? 'PASSED' : 'FAILED'} on ${cfg.interfaceName} (${cfg.prefix64})`,
    );
    return result;
  }

  async allocatePoolAddresses(count: number): Promise<Ipv6PoolEntrySummary[]> {
    const cfg = this.getConfig();
    if (!cfg.ownershipConfirmed) {
      throw new Error('Bạn phải xác nhận quyền sở hữu tiền tố trước khi tạo địa chỉ');
    }
    if (!cfg.routingVerified) {
      throw new Error('Vui lòng chạy "Kiểm tra định tuyến" thành công trước khi tạo hàng loạt');
    }
    const existingRows = this.db.select().from(ipv6PoolTable).all();
    const clampedCount = Math.max(1, Math.floor(count));
    if (existingRows.length + clampedCount > cfg.maxAddresses) {
      throw new Error(
        `Vượt giới hạn kho (${existingRows.length} + ${clampedCount} > ${cfg.maxAddresses})`,
      );
    }

    const exclude = getAllHostIpv6Addresses();
    for (const r of existingRows) exclude.add(r.address);

    const newAddrs: string[] = [];
    for (let i = 0; i < clampedCount; i += 1) {
      const addr = generateRandomIpv6InPrefix64(cfg.prefix64, exclude);
      exclude.add(addr);
      newAddrs.push(addr);
    }

    await this.addressManager.assignAddresses(
      cfg.interfaceName,
      cfg.prefix64,
      newAddrs,
      cfg.maxAddresses,
    );

    const nowIso = new Date().toISOString();
    for (const addr of newAddrs) {
      this.db
        .insert(ipv6PoolTable)
        .values({
          address: addr,
          interfaceName: cfg.interfaceName,
          prefix64: cfg.prefix64,
          profileId: null,
          health: 'unknown',
          lastCheckedAt: null,
          assignedAt: nowIso,
        })
        .onConflictDoNothing()
        .run();
    }

    this.logger.info(
      'ipv6pool',
      `Assigned ${newAddrs.length} IPv6 addresses to ${cfg.interfaceName}`,
    );
    return this.getStatus().entries;
  }

  /**
   * Ensure a fixed IPv6 address + authenticated local egress listener for `profileId`.
   * Returns a standard HTTP proxy config pointing to 127.0.0.1:<port> with per-listener auth.
   */
  async resolveProxyForProfile(
    profileId: string,
  ): Promise<{ address: string; proxy: ProfileProxy }> {
    let row = this.db
      .select()
      .from(ipv6PoolTable)
      .where(eq(ipv6PoolTable.profileId, profileId))
      .get();

    if (!row) {
      // Pick an unused address already in pool, or allocate 1 new address
      const freeRow = this.db
        .select()
        .from(ipv6PoolTable)
        .all()
        .find((r) => !r.profileId);

      if (freeRow) {
        this.db
          .update(ipv6PoolTable)
          .set({ profileId })
          .where(eq(ipv6PoolTable.address, freeRow.address))
          .run();
        row = { ...freeRow, profileId };
      } else {
        await this.allocatePoolAddresses(1);
        const created = this.db
          .select()
          .from(ipv6PoolTable)
          .all()
          .find((r) => !r.profileId);
        if (!created) {
          throw new Error('Không thể cấp địa chỉ IPv6 mới cho hồ sơ');
        }
        this.db
          .update(ipv6PoolTable)
          .set({ profileId })
          .where(eq(ipv6PoolTable.address, created.address))
          .run();
        row = { ...created, profileId };
      }
    }

    const listenerInfo = await this.egressManager.ensureListener(row.address);
    return {
      address: row.address,
      proxy: {
        type: 'http',
        host: listenerInfo.host,
        port: listenerInfo.port,
        username: listenerInfo.username,
        password: listenerInfo.password,
      },
    };
  }

  getProfileAddress(profileId: string): string | null {
    const row = this.db
      .select({ address: ipv6PoolTable.address })
      .from(ipv6PoolTable)
      .where(eq(ipv6PoolTable.profileId, profileId))
      .get();
    return row?.address ?? null;
  }

  async rotateProfileAddress(
    profileId: string,
    options: { forceIfRunning?: boolean } = {},
  ): Promise<{ oldAddress: string | null; newAddress: string }> {
    if (this.isProfileRunningFn?.(profileId) && !options.forceIfRunning) {
      throw new Error(
        'Hồ sơ đang chạy. Vui lòng dừng hồ sơ hoặc xác nhận đổi IPv6 (sẽ ngắt các kết nối hiện tại).',
      );
    }

    const cfg = this.getConfig();
    if (!cfg.ownershipConfirmed || !cfg.routingVerified) {
      throw new Error('Tiền tố IPv6 chưa được xác nhận sở hữu và kiểm tra định tuyến');
    }

    const currentRow = this.db
      .select()
      .from(ipv6PoolTable)
      .where(eq(ipv6PoolTable.profileId, profileId))
      .get();

    const exclude = getAllHostIpv6Addresses();
    for (const r of this.db.select({ address: ipv6PoolTable.address }).from(ipv6PoolTable).all()) {
      exclude.add(r.address);
    }

    const newAddr = generateRandomIpv6InPrefix64(cfg.prefix64, exclude);
    await this.addressManager.assignAddresses(
      cfg.interfaceName,
      cfg.prefix64,
      [newAddr],
      cfg.maxAddresses,
    );

    const nowIso = new Date().toISOString();
    if (currentRow) {
      await this.egressManager.stopListener(currentRow.address);
      this.db.delete(ipv6PoolTable).where(eq(ipv6PoolTable.address, currentRow.address)).run();
      try {
        await this.addressManager.removeAddresses(
          currentRow.interfaceName,
          [currentRow.address],
          currentRow.prefix64,
        );
      } catch (err) {
        this.logger.warn(
          'ipv6pool',
          `Could not remove rotated address ${currentRow.address}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.db
      .insert(ipv6PoolTable)
      .values({
        address: newAddr,
        interfaceName: cfg.interfaceName,
        prefix64: cfg.prefix64,
        profileId,
        health: 'unknown',
        lastCheckedAt: null,
        assignedAt: nowIso,
      })
      .run();

    this.logger.info('ipv6pool', `Rotated IPv6 for profile ${profileId}`);
    return { oldAddress: currentRow?.address ?? null, newAddress: newAddr };
  }

  async rotateAllAddresses(forceIfRunning = false): Promise<{ rotated: number }> {
    const rows = this.db.select().from(ipv6PoolTable).all();
    let rotated = 0;
    for (const row of rows) {
      if (row.profileId) {
        await this.rotateProfileAddress(row.profileId, { forceIfRunning });
        rotated += 1;
      } else {
        await this.removeAddress(row.address);
        await this.allocatePoolAddresses(1);
        rotated += 1;
      }
    }
    return { rotated };
  }

  async releaseProfileAddress(profileId: string): Promise<void> {
    const row = this.db
      .select()
      .from(ipv6PoolTable)
      .where(eq(ipv6PoolTable.profileId, profileId))
      .get();
    if (!row) return;
    await this.removeAddress(row.address);
  }

  async removeAddress(rawAddress: string): Promise<void> {
    const norm = normalizeIpv6(rawAddress);
    const row = this.db.select().from(ipv6PoolTable).where(eq(ipv6PoolTable.address, norm)).get();
    if (!row) return;

    await this.egressManager.stopListener(norm);
    try {
      await this.addressManager.removeAddresses(row.interfaceName, [norm], row.prefix64);
    } catch (err) {
      this.logger.warn(
        'ipv6pool',
        `Failed netsh delete for ${norm}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.db.delete(ipv6PoolTable).where(eq(ipv6PoolTable.address, norm)).run();
    this.orphanAddresses = this.orphanAddresses.filter((a) => a !== norm);
    this.logger.info('ipv6pool', `Removed app-assigned IPv6 ${norm}`);
  }

  /**
   * Remove ALL addresses that were assigned by Facet (recorded in ipv6_pool_addresses).
   * NEVER touches any address not in Facet's DB.
   */
  async removeAllAppAddresses(): Promise<{ removed: number }> {
    await this.egressManager.stopAll();
    const rows = this.db.select().from(ipv6PoolTable).all();
    if (rows.length === 0) {
      this.orphanAddresses = [];
      return { removed: 0 };
    }

    // Group by interfaceName so each interface is cleaned in minimal UAC batches
    const byIface = new Map<string, string[]>();
    for (const r of rows) {
      const list = byIface.get(r.interfaceName) ?? [];
      list.push(r.address);
      byIface.set(r.interfaceName, list);
    }

    for (const [iface, addrs] of byIface.entries()) {
      try {
        await this.addressManager.removeAddresses(iface, addrs);
      } catch (err) {
        this.logger.warn(
          'ipv6pool',
          `Batch cleanup warning on ${iface}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.db.delete(ipv6PoolTable).run();
    this.orphanAddresses = [];
    this.logger.info('ipv6pool', `Cleaned up ${rows.length} app-assigned IPv6 addresses`);
    return { removed: rows.length };
  }

  async detectOrphansOnStartup(): Promise<string[]> {
    const rows = this.db.select().from(ipv6PoolTable).all();
    if (rows.length === 0) {
      this.orphanAddresses = [];
      return [];
    }

    const byIface = new Map<string, string[]>();
    for (const r of rows) {
      const list = byIface.get(r.interfaceName) ?? [];
      list.push(r.address);
      byIface.set(r.interfaceName, list);
    }

    const found: string[] = [];
    for (const [iface, addrs] of byIface.entries()) {
      try {
        const orphans = await this.addressManager.detectOrphanAddresses(iface, addrs);
        found.push(...orphans);
      } catch {
        // Ignore if interface no longer exists
      }
    }
    this.orphanAddresses = found;
    if (found.length > 0) {
      this.logger.warn(
        'ipv6pool',
        `Detected ${found.length} orphan IPv6 addresses from previous run`,
      );
    }
    return found;
  }

  async checkHealthAll(concurrency = 5): Promise<Ipv6PoolEntrySummary[]> {
    const cfg = this.getConfig();
    const rows = this.db.select().from(ipv6PoolTable).all();
    if (rows.length === 0) return [];
    const endpoint = cfg.echoEndpoints[0] ?? DEFAULT_IPV6_ECHO_ENDPOINTS[0]!;

    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++]!;
        let health: Ipv6AddressHealth = 'dead';
        try {
          const echoed = await this.fetchEchoFn(endpoint, row.address, 6000);
          if (echoed === row.address) {
            health = 'alive';
          }
        } catch {
          health = 'dead';
        }
        this.db
          .update(ipv6PoolTable)
          .set({ health, lastCheckedAt: new Date().toISOString() })
          .where(eq(ipv6PoolTable.address, row.address))
          .run();
      }
    };

    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), rows.length) }, () =>
      worker(),
    );
    await Promise.all(workers);
    return this.getStatus().entries;
  }

  async shutdown(): Promise<void> {
    if (this.autoRotateTimer) {
      clearInterval(this.autoRotateTimer);
      this.autoRotateTimer = null;
    }
    await this.removeAllAppAddresses();
  }
}
