import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import {
  foldersTable,
  profileAccountsTable,
  profilesTable,
  proxiesTable,
  tagsTable,
} from '../db/schema';
import type {
  BackupPayload,
  BrowserType,
  BulkCreateInput,
  BulkUpdateInput,
  CreateProfileInput,
  Folder,
  Ipv6Policy,
  Platform,
  Profile,
  ProfileFilter,
  ProfileFingerprint,
  ProfileGeo,
  ProfileProxy,
  ProfileStartup,
  ProfileStatus,
  SavedProxy,
  Tag,
  UpdateProfileInput,
} from '@shared/types';
import { parseProfilesCsv, parseQuickProxy } from '@shared/validation';
import {
  normalizeBandwidth,
  normalizeBehavior,
  normalizeDataOnClose,
  normalizeMediaDevices,
  normalizeMeta,
  normalizeSignals,
  normalizeWindow,
} from '@shared/advancedDefaults';
import { generateConsistentIdentity } from './fingerprint/generator';
import { applyDevice, getDeviceById, normalizeBrowserVersion } from './deviceCatalog';
import { PresetService } from './presetService';
import type { SecretService } from './secretService';

type ProfileRow = typeof profilesTable.$inferSelect;

export class ProfileService {
  private db: AppDatabase;
  private secrets: SecretService;
  private profilesRootDir: string;
  private onPermanentDeleteHooks = new Set<(profileId: string) => void>();

  constructor(db: AppDatabase, secrets: SecretService, profilesRootDir: string) {
    this.db = db;
    this.secrets = secrets;
    this.profilesRootDir = profilesRootDir;
  }

  onPermanentDelete(listener: (profileId: string) => void): () => void {
    this.onPermanentDeleteHooks.add(listener);
    return () => {
      this.onPermanentDeleteHooks.delete(listener);
    };
  }

  private encryptProxy(proxy: ProfileProxy): ProfileProxy {
    const encryptedExtra = proxy.extra ? { ...proxy.extra } : undefined;
    if (encryptedExtra && encryptedExtra['uuid']) {
      encryptedExtra['uuid'] = this.secrets.encrypt(encryptedExtra['uuid']);
    }
    return {
      ...proxy,
      password: this.secrets.encrypt(proxy.password),
      ...(proxy.privateKey ? { privateKey: this.secrets.encrypt(proxy.privateKey) } : {}),
      ...(encryptedExtra ? { extra: encryptedExtra } : {}),
      ...(proxy.chain ? { chain: proxy.chain.map((hop) => this.encryptProxy(hop)) } : {}),
    };
  }

  private decryptProxy(proxy: ProfileProxy): ProfileProxy {
    const decryptedExtra = proxy.extra ? { ...proxy.extra } : undefined;
    if (decryptedExtra && decryptedExtra['uuid']) {
      decryptedExtra['uuid'] = this.secrets.decrypt(decryptedExtra['uuid']);
    }
    return {
      ...proxy,
      password: this.secrets.decrypt(proxy.password),
      ...(proxy.privateKey ? { privateKey: this.secrets.decrypt(proxy.privateKey) } : {}),
      ...(decryptedExtra ? { extra: decryptedExtra } : {}),
      ...(proxy.chain ? { chain: proxy.chain.map((hop) => this.decryptProxy(hop)) } : {}),
    };
  }

  private serializeAdvanced(
    p: Pick<
      CreateProfileInput,
      'mediaDevices' | 'dataOnClose' | 'window' | 'bandwidth' | 'behavior' | 'meta' | 'notes' | 'fingerprint'
    >,
  ): string {
    return JSON.stringify({
      mediaDevices: normalizeMediaDevices(p.mediaDevices),
      dataOnClose: normalizeDataOnClose(p.dataOnClose),
      window: normalizeWindow(p.window, p.fingerprint.screen),
      bandwidth: normalizeBandwidth(p.bandwidth),
      behavior: normalizeBehavior(p.behavior),
      meta: normalizeMeta(p.meta, p.notes),
    });
  }

  private rowToProfile(row: ProfileRow): Profile {
    const rawProxy = JSON.parse(row.proxyJson) as ProfileProxy;
    const rawFingerprint = JSON.parse(row.fingerprintJson) as ProfileFingerprint;
    const fingerprint: ProfileFingerprint = {
      ...rawFingerprint,
      signals: normalizeSignals(rawFingerprint.signals),
    };
    let rawAdv: Partial<
      Pick<Profile, 'mediaDevices' | 'dataOnClose' | 'window' | 'bandwidth' | 'behavior' | 'meta'>
    > = {};
    try {
      rawAdv = JSON.parse(row.advancedJson || '{}') as typeof rawAdv;
    } catch {
      rawAdv = {};
    }
    const meta = normalizeMeta(rawAdv.meta, row.notes);

    return {
      id: row.id,
      name: row.name,
      folderId: row.folderId,
      status: row.status as ProfileStatus,
      tags: JSON.parse(row.tagsJson) as string[],
      notes: meta.notes || row.notes,
      platform: row.platform as Platform,
      osVersion: row.osVersion,
      deviceId: row.deviceId ?? null,
      deviceLabel: row.deviceLabel ?? '',
      browser: row.browser as BrowserType,
      browserVersion: row.browserVersion,
      lastBrowserVersion: row.lastBrowserVersion ?? null,
      userAgent: row.userAgent,
      proxy: this.decryptProxy(rawProxy),
      ipv6Policy: (row.ipv6Policy === 'proxy-only' ? 'proxy-only' : 'block') as Ipv6Policy,
      geo: JSON.parse(row.geoJson) as ProfileGeo,
      fingerprint,
      startup: JSON.parse(row.startupJson) as ProfileStartup,
      mediaDevices: normalizeMediaDevices(rawAdv.mediaDevices),
      dataOnClose: normalizeDataOnClose(rawAdv.dataOnClose),
      window: normalizeWindow(rawAdv.window, fingerprint.screen),
      bandwidth: normalizeBandwidth(rawAdv.bandwidth),
      behavior: normalizeBehavior(rawAdv.behavior),
      meta,
      presetId: row.presetId || 'balanced',
      createdAt: row.createdAt,
      lastRunAt: row.lastRunAt,
      deletedAt: row.deletedAt ?? null,
    };
  }

  getProfileDir(profileId: string): string {
    return path.join(this.profilesRootDir, profileId);
  }

  /**
   * Safely remove only recreatable browser cache directories for a profile
   * (never touches cookies, localStorage, IndexedDB, or profile config).
   */
  cleanProfileCache(profileId: string): { freedBytes: number } {
    const dir = this.getProfileDir(profileId);
    if (!fs.existsSync(dir)) return { freedBytes: 0 };

    const calcSize = (p: string): number => {
      if (!fs.existsSync(p)) return 0;
      const stat = fs.statSync(p);
      if (!stat.isDirectory()) return stat.size;
      let sum = 0;
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        sum += calcSize(path.join(p, e.name));
      }
      return sum;
    };

    const cacheDirs = [
      path.join(dir, 'Default', 'Cache'),
      path.join(dir, 'Default', 'Code Cache'),
      path.join(dir, 'Default', 'GPUCache'),
      path.join(dir, 'GrShaderCache'),
      path.join(dir, 'ShaderCache'),
      path.join(dir, 'static-cache'),
      path.join(dir, 'firefox-profile', 'cache2'),
    ];

    let freedBytes = 0;
    for (const target of cacheDirs) {
      if (!fs.existsSync(target)) continue;
      try {
        freedBytes += calcSize(target);
        fs.rmSync(target, { recursive: true, force: true });
      } catch {
        // Ignore locked cache files if browser is open
      }
    }
    return { freedBytes };
  }

  list(filter?: ProfileFilter): Profile[] {
    const conditions: SQL[] = [isNull(profilesTable.deletedAt)];

    if (filter) {
      if (filter.folderId !== undefined && filter.folderId !== null && filter.folderId !== '') {
        conditions.push(eq(profilesTable.folderId, filter.folderId));
      }
      if (filter.status && filter.status !== 'all') {
        conditions.push(eq(profilesTable.status, filter.status));
      }
    }

    const sortBy = filter?.sortBy ?? 'createdAt';
    const sortDir = filter?.sortDir ?? 'desc';
    const orderCol =
      sortBy === 'name'
        ? profilesTable.name
        : sortBy === 'lastRunAt'
          ? profilesTable.lastRunAt
          : profilesTable.createdAt;
    const orderExpr = sortDir === 'asc' ? asc(orderCol) : desc(orderCol);

    const rows = this.db
      .select()
      .from(profilesTable)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .all();

    let profiles = rows.map((r) => this.rowToProfile(r));

    if (filter?.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      profiles = profiles.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.notes.toLowerCase().includes(q) ||
          p.proxy.host.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (filter?.tag && filter.tag.trim()) {
      profiles = profiles.filter((p) => p.tags.includes(filter.tag!));
    }

    return profiles;
  }

  getById(id: string): Profile | null {
    const row = this.db.select().from(profilesTable).where(eq(profilesTable.id, id)).get();
    return row ? this.rowToProfile(row) : null;
  }

  create(input: CreateProfileInput): Profile {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const storedProxy = this.encryptProxy(input.proxy);
    const normalizedFp: ProfileFingerprint = {
      ...input.fingerprint,
      signals: normalizeSignals(input.fingerprint.signals),
    };
    const mediaDevices = normalizeMediaDevices(input.mediaDevices);
    const dataOnClose = normalizeDataOnClose(input.dataOnClose);
    const win = normalizeWindow(input.window, normalizedFp.screen);
    const bandwidth = normalizeBandwidth(input.bandwidth);
    const behavior = normalizeBehavior(input.behavior);
    const meta = normalizeMeta(input.meta, input.notes);
    const presetId = input.presetId || 'balanced';

    this.db
      .insert(profilesTable)
      .values({
        id,
        name: input.name.trim(),
        folderId: input.folderId,
        status: input.status,
        tagsJson: JSON.stringify(input.tags),
        notes: meta.notes || input.notes,
        platform: input.platform,
        osVersion: input.osVersion,
        deviceId: input.deviceId ?? null,
        deviceLabel: input.deviceLabel ?? '',
        browser: input.browser,
        browserVersion: input.browserVersion,
        lastBrowserVersion: input.lastBrowserVersion ?? null,
        userAgent: input.userAgent,
        proxyJson: JSON.stringify(storedProxy),
        ipv6Policy: input.ipv6Policy ?? 'block',
        geoJson: JSON.stringify(input.geo),
        fingerprintJson: JSON.stringify(normalizedFp),
        startupJson: JSON.stringify(input.startup),
        advancedJson: this.serializeAdvanced({
          mediaDevices,
          dataOnClose,
          window: win,
          bandwidth,
          behavior,
          meta,
          notes: meta.notes,
          fingerprint: normalizedFp,
        }),
        presetId,
        createdAt,
        lastRunAt: null,
      })
      .run();

    const dir = this.getProfileDir(id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return {
      ...input,
      name: input.name.trim(),
      notes: meta.notes || input.notes,
      fingerprint: normalizedFp,
      mediaDevices,
      dataOnClose,
      window: win,
      bandwidth,
      behavior,
      meta,
      presetId,
      id,
      createdAt,
      lastRunAt: null,
      deletedAt: null,
    };
  }

  update(input: UpdateProfileInput): Profile {
    const existing = this.getById(input.id);
    if (!existing) {
      throw new Error(`Profile not found: ${input.id}`);
    }

    const nextFingerprint: ProfileFingerprint = {
      ...(input.fingerprint ?? existing.fingerprint),
      signals: normalizeSignals(
        input.fingerprint?.signals ?? existing.fingerprint.signals,
      ),
    };
    const nextMeta = normalizeMeta(
      input.meta ?? existing.meta,
      input.notes !== undefined ? input.notes : existing.notes,
    );

    const merged: Profile = {
      ...existing,
      ...input,
      name: (input.name ?? existing.name).trim(),
      notes: nextMeta.notes,
      proxy: input.proxy ?? existing.proxy,
      geo: input.geo ?? existing.geo,
      fingerprint: nextFingerprint,
      startup: input.startup ?? existing.startup,
      tags: input.tags ?? existing.tags,
      mediaDevices: normalizeMediaDevices(input.mediaDevices ?? existing.mediaDevices),
      dataOnClose: normalizeDataOnClose(input.dataOnClose ?? existing.dataOnClose),
      window: normalizeWindow(input.window ?? existing.window, nextFingerprint.screen),
      bandwidth: normalizeBandwidth(input.bandwidth ?? existing.bandwidth),
      behavior: normalizeBehavior(input.behavior ?? existing.behavior),
      meta: nextMeta,
      presetId: input.presetId ?? existing.presetId ?? 'balanced',
    };

    this.db
      .update(profilesTable)
      .set({
        name: merged.name,
        folderId: merged.folderId,
        status: merged.status,
        tagsJson: JSON.stringify(merged.tags),
        notes: merged.notes,
        platform: merged.platform,
        osVersion: merged.osVersion,
        deviceId: merged.deviceId ?? null,
        deviceLabel: merged.deviceLabel ?? '',
        browser: merged.browser,
        browserVersion: merged.browserVersion,
        lastBrowserVersion: merged.lastBrowserVersion ?? null,
        userAgent: merged.userAgent,
        proxyJson: JSON.stringify(this.encryptProxy(merged.proxy)),
        ipv6Policy: merged.ipv6Policy ?? 'block',
        geoJson: JSON.stringify(merged.geo),
        fingerprintJson: JSON.stringify(merged.fingerprint),
        startupJson: JSON.stringify(merged.startup),
        advancedJson: this.serializeAdvanced(merged),
        presetId: merged.presetId ?? 'balanced',
      })
      .where(eq(profilesTable.id, merged.id))
      .run();

    return merged;
  }

  touchLastRun(id: string, browserVersion?: string): void {
    this.db
      .update(profilesTable)
      .set({
        lastRunAt: new Date().toISOString(),
        ...(browserVersion ? { lastBrowserVersion: browserVersion } : {}),
      })
      .where(eq(profilesTable.id, id))
      .run();
  }

  // Soft-delete: move to Trash so accidental deletes can be restored
  delete(id: string): void {
    this.db
      .update(profilesTable)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(profilesTable.id, id))
      .run();
  }

  listTrash(): Profile[] {
    return this.db
      .select()
      .from(profilesTable)
      .all()
      .map((r) => this.rowToProfile(r))
      .filter((p) => p.deletedAt !== null)
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
  }

  restore(id: string): void {
    this.db.update(profilesTable).set({ deletedAt: null }).where(eq(profilesTable.id, id)).run();
  }

  permanentDelete(id: string): void {
    // Only remove profile-account links; NEVER delete accounts inside vault.db.
    this.db.delete(profileAccountsTable).where(eq(profileAccountsTable.profileId, id)).run();
    this.db.delete(profilesTable).where(eq(profilesTable.id, id)).run();
    for (const hook of this.onPermanentDeleteHooks) {
      try {
        hook(id);
      } catch {
        // Ignore hook errors
      }
    }
    const dir = this.getProfileDir(id);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore if directory is temporarily locked
      }
    }
  }

  emptyTrash(): number {
    const trashed = this.listTrash();
    for (const p of trashed) {
      this.permanentDelete(p.id);
    }
    return trashed.length;
  }

  importCsv(rawCsv: string, folderId: string | null = null): Profile[] {
    const rows = parseProfilesCsv(rawCsv);
    const created: Profile[] = [];
    for (const row of rows) {
      const identity = generateConsistentIdentity(row.platform, row.browser);
      const parsedProxy = row.proxyRaw ? parseQuickProxy(row.proxyRaw) : null;
      const profile = this.create({
        name: row.name,
        folderId,
        status: 'none',
        tags: row.tags,
        notes: row.notes,
        platform: identity.platform,
        osVersion: identity.osVersion,
        browser: identity.browser,
        browserVersion: identity.browserVersion,
        userAgent: identity.userAgent,
        proxy: parsedProxy ?? { type: 'none', host: '', port: 0, username: '', password: '' },
        ipv6Policy: 'block',
        geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
        fingerprint: identity.fingerprint,
        startup: { urls: [], restoreTabs: false },
      });
      created.push(profile);
    }
    return created;
  }

  duplicate(id: string): Profile {
    const original = this.getById(id);
    if (!original) {
      throw new Error(`Profile not found: ${id}`);
    }
    const freshIdentity = generateConsistentIdentity(original.platform, original.browser);
    return this.create({
      name: `${original.name} (Copy)`,
      folderId: original.folderId,
      status: original.status,
      tags: [...original.tags],
      notes: original.notes,
      platform: original.platform,
      osVersion: freshIdentity.osVersion,
      browser: original.browser,
      browserVersion: freshIdentity.browserVersion,
      userAgent: freshIdentity.userAgent,
      proxy: { ...original.proxy },
      ipv6Policy: original.ipv6Policy,
      geo: { ...original.geo },
      fingerprint: freshIdentity.fingerprint,
      startup: { ...original.startup, urls: [...original.startup.urls] },
    });
  }

  bulkDelete(ids: string[]): number {
    if (ids.length === 0) return 0;
    this.db
      .update(profilesTable)
      .set({ deletedAt: new Date().toISOString() })
      .where(inArray(profilesTable.id, ids))
      .run();
    return ids.length;
  }

  bulkUpdate(input: BulkUpdateInput): number {
    const device = input.deviceId ? getDeviceById(input.deviceId) : null;
    const presetService = input.presetId ? new PresetService(this.db) : null;
    const preset = input.presetId && presetService ? presetService.getPresetById(input.presetId) : null;

    return this.db.transaction(() => {
      let count = 0;
      for (const id of input.ids) {
      const existing = this.getById(id);
      if (!existing) continue;
      const nextTags = input.addTags
        ? Array.from(new Set([...existing.tags, ...input.addTags]))
        : existing.tags;

      const targetVersion = input.browserVersion
        ? normalizeBrowserVersion(input.browserVersion)
        : existing.browserVersion;

      const baseSignals = normalizeSignals(preset ? preset.signals : existing.fingerprint.signals);
      const nextSignals = input.signals ? normalizeSignals({ ...baseSignals, ...input.signals }) : baseSignals;
      const nextWebrtc = input.webrtc ?? (preset ? preset.webrtc : existing.fingerprint.webrtc);
      const nextMediaDevices = normalizeMediaDevices({
        ...(preset ? preset.mediaDevices : existing.mediaDevices),
        ...(input.mediaDevices ?? {}),
      });
      const nextDataOnClose = normalizeDataOnClose({
        ...(preset ? preset.dataOnClose : existing.dataOnClose),
        ...(input.dataOnClose ?? {}),
      });
      const nextBandwidth = normalizeBandwidth({
        ...(preset ? preset.bandwidth : existing.bandwidth),
        ...(input.bandwidth ?? {}),
      });
      const nextBehavior = normalizeBehavior({
        ...(preset ? preset.behavior : existing.behavior),
        ...(input.behavior ?? {}),
      });
      const nextMeta = normalizeMeta(
        {
          ...(existing.meta ?? {}),
          ...(input.meta ?? {}),
        },
        existing.notes,
      );
      const nextPresetId = preset
        ? preset.id
        : input.signals ||
            input.mediaDevices ||
            input.webrtc ||
            input.dataOnClose ||
            input.bandwidth ||
            input.behavior
          ? 'custom'
          : existing.presetId;

      if (device) {
        const applied = applyDevice(existing, device, targetVersion);
        this.update({
          ...applied,
          id,
          folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
          status: input.status ?? existing.status,
          tags: nextTags,
          proxy: input.proxy ?? existing.proxy,
          fingerprint: {
            ...applied.fingerprint,
            webrtc: nextWebrtc,
            signals: nextSignals,
          },
          mediaDevices: nextMediaDevices,
          dataOnClose: nextDataOnClose,
          bandwidth: nextBandwidth,
          behavior: nextBehavior,
          meta: nextMeta,
          presetId: nextPresetId,
        });
      } else {
        let nextUa = existing.userAgent;
        if (input.browserVersion && existing.platform !== 'ios' && nextUa !== 'auto') {
          if (existing.browser === 'firefox') {
            const major = targetVersion.split('.')[0] ?? '136';
            nextUa = nextUa
              .replace(/rv:\d+\.\d+/i, `rv:${major}.0`)
              .replace(/Firefox\/\d+\.\d+/i, `Firefox/${major}.0`);
          } else {
            nextUa = nextUa.replace(/Chrome\/\d+(?:\.\d+)*/i, `Chrome/${targetVersion}`);
          }
        }
        this.update({
          id,
          folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
          status: input.status ?? existing.status,
          tags: nextTags,
          proxy: input.proxy ?? existing.proxy,
          browserVersion: targetVersion,
          userAgent: nextUa,
          fingerprint: {
            ...existing.fingerprint,
            webrtc: nextWebrtc,
            signals: nextSignals,
          },
          mediaDevices: nextMediaDevices,
          dataOnClose: nextDataOnClose,
          bandwidth: nextBandwidth,
          behavior: nextBehavior,
          meta: nextMeta,
          presetId: nextPresetId,
        });
      }
      count += 1;
    }
    return count;
    });
  }

  bulkCreate(input: BulkCreateInput): Profile[] {
    const created: Profile[] = [];
    const safeCount = Math.max(1, Math.min(200, input.count));
    for (let i = 0; i < safeCount; i += 1) {
      const fresh = generateConsistentIdentity(input.template.platform, input.template.browser);
      const rawProxyLine = input.proxyList[i];
      const parsedProxy = rawProxyLine ? parseQuickProxy(rawProxyLine) : null;
      const profile = this.create({
        ...input.template,
        name: `${input.baseName} #${i + 1}`,
        osVersion: fresh.osVersion,
        browserVersion: fresh.browserVersion,
        userAgent: fresh.userAgent,
        fingerprint: {
          ...fresh.fingerprint,
          webrtc: input.template.fingerprint.webrtc,
        },
        proxy: parsedProxy ?? { ...input.template.proxy },
      });
      created.push(profile);
    }
    return created;
  }

  // Folders
  listFolders(): Folder[] {
    return this.db.select().from(foldersTable).all();
  }

  createFolder(name: string): Folder {
    const folder: Folder = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    };
    this.db.insert(foldersTable).values(folder).run();
    return folder;
  }

  deleteFolder(id: string): void {
    this.db
      .update(profilesTable)
      .set({ folderId: null })
      .where(eq(profilesTable.folderId, id))
      .run();
    this.db.delete(foldersTable).where(eq(foldersTable.id, id)).run();
  }

  // Tags
  listTags(): Tag[] {
    return this.db.select().from(tagsTable).all();
  }

  createTag(name: string, color = '#3b82f6'): Tag {
    const trimmed = name.trim();
    const existing = this.db.select().from(tagsTable).where(eq(tagsTable.name, trimmed)).get();
    if (existing) {
      return existing;
    }
    const tag: Tag = {
      id: crypto.randomUUID(),
      name: trimmed,
      color,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(tagsTable).values(tag).run();
    return tag;
  }

  deleteTag(id: string): void {
    this.db.delete(tagsTable).where(eq(tagsTable.id, id)).run();
  }

  // ---- Profile <-> Vault Account Links (never stores secrets) ----

  linkAccount(profileId: string, email: string): void {
    const clean = email.trim().toLowerCase();
    if (!clean) throw new Error('Email không hợp lệ');
    const profile = this.getById(profileId);
    if (!profile) throw new Error(`Không tìm thấy hồ sơ: ${profileId}`);
    this.db
      .insert(profileAccountsTable)
      .values({
        profileId,
        accountEmail: clean,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  unlinkAccount(profileId: string, email: string): void {
    const clean = email.trim().toLowerCase();
    this.db
      .delete(profileAccountsTable)
      .where(
        and(
          eq(profileAccountsTable.profileId, profileId),
          eq(profileAccountsTable.accountEmail, clean),
        ),
      )
      .run();
  }

  unlinkAccountEverywhere(email: string): void {
    const clean = email.trim().toLowerCase();
    this.db
      .delete(profileAccountsTable)
      .where(eq(profileAccountsTable.accountEmail, clean))
      .run();
  }

  listLinkedAccounts(profileId: string): string[] {
    const rows = this.db
      .select({ email: profileAccountsTable.accountEmail })
      .from(profileAccountsTable)
      .where(eq(profileAccountsTable.profileId, profileId))
      .orderBy(asc(profileAccountsTable.accountEmail))
      .all();
    return rows.map((r) => r.email);
  }

  listAllProfileAccountLinks(): Record<string, string[]> {
    const rows = this.db
      .select({
        profileId: profileAccountsTable.profileId,
        email: profileAccountsTable.accountEmail,
      })
      .from(profileAccountsTable)
      .orderBy(asc(profileAccountsTable.accountEmail))
      .all();
    const map: Record<string, string[]> = {};
    for (const r of rows) {
      const list = map[r.profileId] ?? [];
      list.push(r.email);
      map[r.profileId] = list;
    }
    return map;
  }

  listProfilesForAccount(email: string): { id: string; name: string }[] {
    const clean = email.trim().toLowerCase();
    const links = this.db
      .select({ profileId: profileAccountsTable.profileId })
      .from(profileAccountsTable)
      .where(eq(profileAccountsTable.accountEmail, clean))
      .all();
    if (links.length === 0) return [];
    const ids = links.map((l) => l.profileId);
    const profiles = this.db
      .select({ id: profilesTable.id, name: profilesTable.name })
      .from(profilesTable)
      .where(and(inArray(profilesTable.id, ids), isNull(profilesTable.deletedAt)))
      .all();
    return profiles;
  }

  // Backup / Restore (vault.db secrets are NEVER included in profile backup by default)
  exportBackup(): BackupPayload {
    const rawProxies = this.db.select().from(proxiesTable).all();
    const proxies: SavedProxy[] = rawProxies.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as SavedProxy['type'],
      host: p.host,
      port: p.port,
      username: p.username,
      password: this.secrets.decrypt(p.passwordEnc),
      country: p.country,
      createdAt: p.createdAt,
    }));

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: this.listFolders(),
      tags: this.listTags(),
      proxies,
      profiles: this.list(),
    };
  }

  importBackup(payload: BackupPayload): { profiles: number; folders: number; proxies: number } {
    let foldersCount = 0;
    let proxiesCount = 0;
    let profilesCount = 0;

    for (const folder of payload.folders) {
      const exists = this.db
        .select()
        .from(foldersTable)
        .where(eq(foldersTable.id, folder.id))
        .get();
      if (!exists) {
        this.db.insert(foldersTable).values(folder).run();
        foldersCount += 1;
      }
    }

    for (const tag of payload.tags) {
      const exists = this.db.select().from(tagsTable).where(eq(tagsTable.name, tag.name)).get();
      if (!exists) {
        this.db.insert(tagsTable).values(tag).run();
      }
    }

    for (const proxy of payload.proxies) {
      const exists = this.db.select().from(proxiesTable).where(eq(proxiesTable.id, proxy.id)).get();
      if (!exists) {
        this.db
          .insert(proxiesTable)
          .values({
            id: proxy.id,
            name: proxy.name,
            type: proxy.type,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username,
            passwordEnc: this.secrets.encrypt(proxy.password),
            country: proxy.country,
            createdAt: proxy.createdAt,
          })
          .run();
        proxiesCount += 1;
      }
    }

    for (const profile of payload.profiles) {
      const exists = this.getById(profile.id);
      if (!exists) {
        this.db
          .insert(profilesTable)
          .values({
            id: profile.id,
            name: profile.name,
            folderId: profile.folderId,
            status: profile.status,
            tagsJson: JSON.stringify(profile.tags),
            notes: profile.notes,
            platform: profile.platform,
            osVersion: profile.osVersion,
            browser: profile.browser,
            browserVersion: profile.browserVersion,
            userAgent: profile.userAgent,
            proxyJson: JSON.stringify(this.encryptProxy(profile.proxy)),
            geoJson: JSON.stringify(profile.geo),
            fingerprintJson: JSON.stringify(profile.fingerprint),
            startupJson: JSON.stringify(profile.startup),
            createdAt: profile.createdAt,
            lastRunAt: profile.lastRunAt,
          })
          .run();
        profilesCount += 1;
      }
    }

    return { profiles: profilesCount, folders: foldersCount, proxies: proxiesCount };
  }
}
