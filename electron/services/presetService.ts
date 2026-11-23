import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import builtInPresetsRaw from '../../data/presets.json';
import type { ProfilePreset } from '@shared/types';
import {
  normalizeBandwidth,
  normalizeBehavior,
  normalizeDataOnClose,
  normalizeMediaDevices,
  normalizeSignals,
} from '@shared/advancedDefaults';
import type { AppDatabase } from '../db';
import { settingsTable } from '../db/schema';

const CUSTOM_PRESETS_KEY = 'custom_presets';

export const BUILTIN_PRESETS: readonly ProfilePreset[] = (builtInPresetsRaw as ProfilePreset[]).map(
  (p) => ({ ...p, builtIn: true }),
);

export function getBuiltInPresetById(id: string): ProfilePreset | null {
  return BUILTIN_PRESETS.find((p) => p.id === id) ?? null;
}

export class PresetService {
  private db: AppDatabase;
  private cachedPresets: ProfilePreset[] | null = null;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  private readCustomPresets(): ProfilePreset[] {
    const row = this.db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, CUSTOM_PRESETS_KEY))
      .get();
    if (!row?.value) return [];
    try {
      const parsed = JSON.parse(row.value) as ProfilePreset[];
      return Array.isArray(parsed)
        ? parsed.map((p) => ({
            ...p,
            builtIn: false,
            signals: normalizeSignals(p.signals),
            mediaDevices: normalizeMediaDevices(p.mediaDevices),
            dataOnClose: normalizeDataOnClose(p.dataOnClose),
            bandwidth: normalizeBandwidth(p.bandwidth),
            behavior: normalizeBehavior(p.behavior),
          }))
        : [];
    } catch {
      return [];
    }
  }

  private writeCustomPresets(list: ProfilePreset[]): void {
    const serialized = JSON.stringify(list);
    this.db
      .insert(settingsTable)
      .values({ key: CUSTOM_PRESETS_KEY, value: serialized })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: serialized },
      })
      .run();
  }

  listPresets(): ProfilePreset[] {
    if (this.cachedPresets) {
      return [...this.cachedPresets];
    }
    this.cachedPresets = [...BUILTIN_PRESETS, ...this.readCustomPresets()];
    return [...this.cachedPresets];
  }

  getPresetById(id: string): ProfilePreset | null {
    return this.listPresets().find((p) => p.id === id) ?? null;
  }

  saveCustomPreset(input: Omit<ProfilePreset, 'id' | 'builtIn'>): ProfilePreset {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Tên preset không được để trống');
    }
    const created: ProfilePreset = {
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name,
      description: input.description.trim() || 'Preset tùy chỉnh của người dùng',
      builtIn: false,
      signals: normalizeSignals(input.signals),
      mediaDevices: normalizeMediaDevices(input.mediaDevices),
      webrtc: input.webrtc,
      dataOnClose: normalizeDataOnClose(input.dataOnClose),
      bandwidth: normalizeBandwidth(input.bandwidth),
      behavior: normalizeBehavior(input.behavior),
    };
    const existing = this.readCustomPresets();
    this.writeCustomPresets([...existing, created]);
    this.cachedPresets = null;
    return created;
  }

  deleteCustomPreset(id: string): boolean {
    if (BUILTIN_PRESETS.some((p) => p.id === id)) {
      return false;
    }
    const existing = this.readCustomPresets();
    const filtered = existing.filter((p) => p.id !== id);
    if (filtered.length === existing.length) return false;
    this.writeCustomPresets(filtered);
    this.cachedPresets = null;
    return true;
  }
}
