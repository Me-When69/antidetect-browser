import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DbContext {
  sqlite: Database.Database;
  db: AppDatabase;
  dbPath: string;
}

export function createDatabase(dbPath: string): DbContext {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('cache_size = -16000');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      password_enc TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder_id TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      tags_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'windows',
      os_version TEXT NOT NULL DEFAULT 'Windows 11',
      device_id TEXT,
      device_label TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT 'chrome',
      browser_version TEXT NOT NULL DEFAULT '131.0.6778.204',
      last_browser_version TEXT,
      user_agent TEXT NOT NULL DEFAULT 'auto',
      proxy_json TEXT NOT NULL,
      ipv6_policy TEXT NOT NULL DEFAULT 'block',
      geo_json TEXT NOT NULL,
      fingerprint_json TEXT NOT NULL,
      startup_json TEXT NOT NULL,
      advanced_json TEXT NOT NULL DEFAULT '{}',
      preset_id TEXT NOT NULL DEFAULT 'balanced',
      created_at TEXT NOT NULL,
      last_run_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_accounts (
      profile_id TEXT NOT NULL,
      account_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, account_email)
    );
  `);

  // Safe migration for existing databases created before Trash support
  const columns = sqlite.prepare('PRAGMA table_info(profiles)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'deleted_at')) {
    sqlite.exec('ALTER TABLE profiles ADD COLUMN deleted_at TEXT');
  }
  if (!columns.some((c) => c.name === 'ipv6_policy')) {
    sqlite.exec("ALTER TABLE profiles ADD COLUMN ipv6_policy TEXT NOT NULL DEFAULT 'block'");
  }
  if (!columns.some((c) => c.name === 'device_id')) {
    sqlite.exec('ALTER TABLE profiles ADD COLUMN device_id TEXT');
  }
  if (!columns.some((c) => c.name === 'device_label')) {
    sqlite.exec("ALTER TABLE profiles ADD COLUMN device_label TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((c) => c.name === 'last_browser_version')) {
    sqlite.exec('ALTER TABLE profiles ADD COLUMN last_browser_version TEXT');
  }
  if (!columns.some((c) => c.name === 'advanced_json')) {
    sqlite.exec("ALTER TABLE profiles ADD COLUMN advanced_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!columns.some((c) => c.name === 'preset_id')) {
    sqlite.exec("ALTER TABLE profiles ADD COLUMN preset_id TEXT NOT NULL DEFAULT 'balanced'");
  }

  // Indexes for fast filtering & sorting on 1,000+ profiles
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_profiles_active_created ON profiles (deleted_at, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_profiles_active_folder_created ON profiles (deleted_at, folder_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_profiles_active_status ON profiles (deleted_at, status);
    CREATE INDEX IF NOT EXISTS idx_profiles_active_name ON profiles (deleted_at, name);
    CREATE INDEX IF NOT EXISTS idx_profiles_active_lastrun ON profiles (deleted_at, last_run_at DESC);
    CREATE INDEX IF NOT EXISTS idx_profile_accounts_profile ON profile_accounts (profile_id);
    CREATE INDEX IF NOT EXISTS idx_profile_accounts_email ON profile_accounts (account_email);
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db, dbPath };
}
