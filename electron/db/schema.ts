import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const foldersTable = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tagsTable = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull().default('#3b82f6'),
  createdAt: text('created_at').notNull(),
});

export const proxiesTable = sqliteTable('proxies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull().default(''),
  passwordEnc: text('password_enc').notNull().default(''),
  country: text('country').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

export const profilesTable = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  folderId: text('folder_id'),
  status: text('status').notNull().default('none'),
  tagsJson: text('tags_json').notNull().default('[]'),
  notes: text('notes').notNull().default(''),
  platform: text('platform').notNull().default('windows'),
  osVersion: text('os_version').notNull().default('Windows 11'),
  deviceId: text('device_id'),
  deviceLabel: text('device_label').notNull().default(''),
  browser: text('browser').notNull().default('chrome'),
  browserVersion: text('browser_version').notNull().default('131.0.6778.204'),
  lastBrowserVersion: text('last_browser_version'),
  userAgent: text('user_agent').notNull().default('auto'),
  proxyJson: text('proxy_json').notNull(),
  ipv6Policy: text('ipv6_policy').notNull().default('block'),
  geoJson: text('geo_json').notNull(),
  fingerprintJson: text('fingerprint_json').notNull(),
  startupJson: text('startup_json').notNull(),
  createdAt: text('created_at').notNull(),
  lastRunAt: text('last_run_at'),
  deletedAt: text('deleted_at'),
});

export const settingsTable = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
