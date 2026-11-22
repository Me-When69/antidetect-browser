import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { settingsTable } from '../db/schema';
import type { AppSettings, LocaleCode } from '@shared/types';

const KEYS = {
  LOCALE: 'locale',
  CHROME_PATH: 'chromePath',
  CAMOUFOX_PATH: 'camoufoxPath',
  LOCAL_API_ENABLED: 'localApiEnabled',
  LOCAL_API_PORT: 'localApiPort',
  LOCAL_API_KEY: 'localApiKey',
} as const;

export class SettingsService {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
    this.ensureDefaults();
  }

  private getRaw(key: string): string | null {
    const row = this.db.select().from(settingsTable).where(eq(settingsTable.key, key)).get();
    return row ? row.value : null;
  }

  private setRaw(key: string, value: string): void {
    this.db
      .insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value },
      })
      .run();
  }

  private ensureDefaults(): void {
    if (!this.getRaw(KEYS.LOCALE)) {
      this.setRaw(KEYS.LOCALE, 'vi');
    }
    if (!this.getRaw(KEYS.LOCAL_API_ENABLED)) {
      this.setRaw(KEYS.LOCAL_API_ENABLED, 'true');
    }
    if (!this.getRaw(KEYS.LOCAL_API_PORT)) {
      this.setRaw(KEYS.LOCAL_API_PORT, '36912');
    }
    if (!this.getRaw(KEYS.LOCAL_API_KEY)) {
      this.setRaw(KEYS.LOCAL_API_KEY, `ad_${crypto.randomBytes(24).toString('hex')}`);
    }
  }

  getSettings(): AppSettings {
    const localeRaw = this.getRaw(KEYS.LOCALE);
    const locale: LocaleCode = localeRaw === 'en' ? 'en' : 'vi';
    const portNum = Number(this.getRaw(KEYS.LOCAL_API_PORT) ?? '36912');
    return {
      locale,
      chromePath: this.getRaw(KEYS.CHROME_PATH) ?? '',
      camoufoxPath: this.getRaw(KEYS.CAMOUFOX_PATH) ?? '',
      localApiEnabled: this.getRaw(KEYS.LOCAL_API_ENABLED) !== 'false',
      localApiPort: Number.isInteger(portNum) && portNum > 0 ? portNum : 36912,
      localApiKey: this.getRaw(KEYS.LOCAL_API_KEY) ?? '',
    };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    if (patch.locale !== undefined) this.setRaw(KEYS.LOCALE, patch.locale);
    if (patch.chromePath !== undefined) this.setRaw(KEYS.CHROME_PATH, patch.chromePath.trim());
    if (patch.camoufoxPath !== undefined)
      this.setRaw(KEYS.CAMOUFOX_PATH, patch.camoufoxPath.trim());
    if (patch.localApiEnabled !== undefined)
      this.setRaw(KEYS.LOCAL_API_ENABLED, String(patch.localApiEnabled));
    if (patch.localApiPort !== undefined)
      this.setRaw(KEYS.LOCAL_API_PORT, String(patch.localApiPort));
    if (patch.localApiKey !== undefined) this.setRaw(KEYS.LOCAL_API_KEY, patch.localApiKey);
    return this.getSettings();
  }

  regenerateApiKey(): string {
    const key = `ad_${crypto.randomBytes(24).toString('hex')}`;
    this.setRaw(KEYS.LOCAL_API_KEY, key);
    return key;
  }
}
