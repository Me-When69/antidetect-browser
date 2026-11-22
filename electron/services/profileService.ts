import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { foldersTable, profilesTable, proxiesTable, tagsTable } from '../db/schema';
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
import { generateConsistentIdentity } from './fingerprint/generator';
import type { SecretService } from './secretService';

type ProfileRow = typeof profilesTable.$inferSelect;

export class ProfileService {
  private db: AppDatabase;
  private secrets: SecretService;
  private profilesRootDir: string;

  constructor(db: AppDatabase, secrets: SecretService, profilesRootDir: string) {
    this.db = db;
    this.secrets = secrets;
    this.profilesRootDir = profilesRootDir;
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

  private rowToProfile(row: ProfileRow): Profile {
    const rawProxy = JSON.parse(row.proxyJson) as ProfileProxy;
    return {
      id: row.id,
      name: row.name,
      folderId: row.folderId,
      status: row.status as ProfileStatus,
      tags: JSON.parse(row.tagsJson) as string[],
      notes: row.notes,
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
      fingerprint: JSON.parse(row.fingerprintJson) as ProfileFingerprint,
      startup: JSON.parse(row.startupJson) as ProfileStartup,
      createdAt: row.createdAt,
      lastRunAt: row.lastRunAt,
      deletedAt: row.deletedAt ?? null,
    };
  }

  getProfileDir(profileId: string): string {
    return path.join(this.profilesRootDir, profileId);
  }

  list(filter?: ProfileFilter): Profile[] {
    const rows = this.db.select().from(profilesTable).all();
    let profiles = rows.map((r) => this.rowToProfile(r)).filter((p) => p.deletedAt === null);

    if (filter) {
      if (filter.search && filter.search.trim()) {
        const q = filter.search.trim().toLowerCase();
        profiles = profiles.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.notes.toLowerCase().includes(q) ||
            p.proxy.host.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      if (filter.folderId !== undefined && filter.folderId !== null && filter.folderId !== '') {
        profiles = profiles.filter((p) => p.folderId === filter.folderId);
      }
      if (filter.tag && filter.tag.trim()) {
        profiles = profiles.filter((p) => p.tags.includes(filter.tag!));
      }
      if (filter.status && filter.status !== 'all') {
        profiles = profiles.filter((p) => p.status === filter.status);
      }

      const sortBy = filter.sortBy ?? 'createdAt';
      const sortDir = filter.sortDir ?? 'desc';
      const dir = sortDir === 'asc' ? 1 : -1;
      profiles.sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name) * dir;
        }
        if (sortBy === 'lastRunAt') {
          return (a.lastRunAt ?? '').localeCompare(b.lastRunAt ?? '') * dir;
        }
        return a.createdAt.localeCompare(b.createdAt) * dir;
      });
    } else {
      profiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

    this.db
      .insert(profilesTable)
      .values({
        id,
        name: input.name.trim(),
        folderId: input.folderId,
        status: input.status,
        tagsJson: JSON.stringify(input.tags),
        notes: input.notes,
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
        fingerprintJson: JSON.stringify(input.fingerprint),
        startupJson: JSON.stringify(input.startup),
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

    const merged: Profile = {
      ...existing,
      ...input,
      name: (input.name ?? existing.name).trim(),
      proxy: input.proxy ?? existing.proxy,
      geo: input.geo ?? existing.geo,
      fingerprint: input.fingerprint ?? existing.fingerprint,
      startup: input.startup ?? existing.startup,
      tags: input.tags ?? existing.tags,
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
    this.db.delete(profilesTable).where(eq(profilesTable.id, id)).run();
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
    let count = 0;
    for (const id of input.ids) {
      const existing = this.getById(id);
      if (!existing) continue;
      const nextTags = input.addTags
        ? Array.from(new Set([...existing.tags, ...input.addTags]))
        : existing.tags;
      this.update({
        id,
        folderId: input.folderId !== undefined ? input.folderId : existing.folderId,
        status: input.status ?? existing.status,
        tags: nextTags,
        proxy: input.proxy ?? existing.proxy,
      });
      count += 1;
    }
    return count;
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

  // Backup / Restore
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
