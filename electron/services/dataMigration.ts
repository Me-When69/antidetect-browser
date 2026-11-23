import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MIGRATION_MARKER_FILE = '.facet-migration-v1.json';

const MIGRATE_ITEMS = [
  'data',
  'vault.db',
  'vault.db-wal',
  'vault.db-shm',
  'browsers',
  'cores',
  'bridge-pids.json',
] as const;

export interface MigrationResult {
  migrated: boolean;
  reason: 'completed' | 'already-migrated' | 'no-legacy-dir' | 'same-dir';
  filesCopied: number;
  filesVerified: number;
  legacyDir: string;
  targetDir: string;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function copyFileVerified(src: string, dst: string): { copied: boolean; verified: boolean } {
  const srcHash = sha256File(src);
  if (fs.existsSync(dst)) {
    try {
      if (sha256File(dst) === srcHash) {
        return { copied: false, verified: true };
      }
    } catch {
      // Fall through and re-copy
    }
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = `${dst}.migrating-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.copyFileSync(src, tmp);
    const tmpHash = sha256File(tmp);
    if (tmpHash !== srcHash) {
      throw new Error(`Kiểm tra toàn vẹn SHA-256 thất bại khi di chuyển: ${path.basename(src)}`);
    }
    fs.renameSync(tmp, dst);
    return { copied: true, verified: true };
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

function copyDirVerified(srcDir: string, dstDir: string): { copied: number; verified: number } {
  let copied = 0;
  let verified = 0;
  fs.mkdirSync(dstDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDirVerified(srcPath, dstPath);
      copied += sub.copied;
      verified += sub.verified;
    } else if (entry.isFile()) {
      const res = copyFileVerified(srcPath, dstPath);
      if (res.copied) copied += 1;
      if (res.verified) verified += 1;
    }
  }
  return { copied, verified };
}

/**
 * Idempotent, crash-safe one-time migration from legacy `antidetect-app` userData
 * directory to the new `Facet` userData directory.
 *
 * - Copies data/profiles, antidetect.db, vault.db, browsers, cores, bridge-pids.json.
 * - Verifies SHA-256 of every single copied file via atomic temp-file + rename.
 * - Safe to re-run if interrupted mid-way (skips already-verified files, repairs corrupt ones).
 * - NEVER deletes `legacyDir` (user can safely verify and remove it manually later).
 */
export function migrateLegacyUserDataIfNeeded(
  legacyDir: string,
  targetDir: string,
): MigrationResult {
  const normLegacy = path.resolve(legacyDir);
  const normTarget = path.resolve(targetDir);

  if (normLegacy.toLowerCase() === normTarget.toLowerCase()) {
    return {
      migrated: false,
      reason: 'same-dir',
      filesCopied: 0,
      filesVerified: 0,
      legacyDir: normLegacy,
      targetDir: normTarget,
    };
  }

  const markerPath = path.join(normTarget, MIGRATION_MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    return {
      migrated: false,
      reason: 'already-migrated',
      filesCopied: 0,
      filesVerified: 0,
      legacyDir: normLegacy,
      targetDir: normTarget,
    };
  }

  if (!fs.existsSync(normLegacy)) {
    return {
      migrated: false,
      reason: 'no-legacy-dir',
      filesCopied: 0,
      filesVerified: 0,
      legacyDir: normLegacy,
      targetDir: normTarget,
    };
  }

  fs.mkdirSync(normTarget, { recursive: true });
  let filesCopied = 0;
  let filesVerified = 0;

  for (const item of MIGRATE_ITEMS) {
    const srcPath = path.join(normLegacy, item);
    if (!fs.existsSync(srcPath)) continue;
    const dstPath = path.join(normTarget, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      const sub = copyDirVerified(srcPath, dstPath);
      filesCopied += sub.copied;
      filesVerified += sub.verified;
    } else if (stat.isFile()) {
      const res = copyFileVerified(srcPath, dstPath);
      if (res.copied) filesCopied += 1;
      if (res.verified) filesVerified += 1;
    }
  }

  const markerPayload = {
    version: 1,
    migratedAt: new Date().toISOString(),
    filesCopied,
    filesVerified,
  };
  fs.writeFileSync(markerPath, JSON.stringify(markerPayload, null, 2), 'utf8');

  return {
    migrated: true,
    reason: 'completed',
    filesCopied,
    filesVerified,
    legacyDir: normLegacy,
    targetDir: normTarget,
  };
}
