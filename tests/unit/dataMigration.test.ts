import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIGRATION_MARKER_FILE,
  migrateLegacyUserDataIfNeeded,
} from '../../electron/services/dataMigration';
import { VaultService } from '../../electron/services/vault/vaultService';

describe('PHA 0b: Safe Legacy UserData Migration (antidetect-app -> Facet)', () => {
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

  it('migrates profiles, vault.db, and metadata with SHA-256 verification, preserves legacy dir, and keeps vault unlockable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-mig-'));
    tempDirs.push(root);

    const legacyDir = path.join(root, 'antidetect-app');
    const targetDir = path.join(root, 'Facet');
    fs.mkdirSync(path.join(legacyDir, 'data', 'profiles', 'prof-1'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'data', 'profiles', 'prof-1', 'Preferences'),
      '{"ok":true}',
      'utf8',
    );
    fs.writeFileSync(path.join(legacyDir, 'bridge-pids.json'), '[]', 'utf8');

    // Create a real encrypted vault.db in legacyDir
    const legacyVault = new VaultService(path.join(legacyDir, 'vault.db'));
    legacyVault.unlock('MigrationMaster!1');
    legacyVault.addAccount({ email: 'user@example.com', password: 'SecretPassword!123' });
    legacyVault.close();

    const res1 = migrateLegacyUserDataIfNeeded(legacyDir, targetDir);
    expect(res1.migrated).toBe(true);
    expect(res1.reason).toBe('completed');
    expect(res1.filesCopied).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(path.join(targetDir, MIGRATION_MARKER_FILE))).toBe(true);

    // Legacy directory MUST NOT be deleted
    expect(fs.existsSync(path.join(legacyDir, 'vault.db'))).toBe(true);

    // Migrated vault.db MUST unlock and decrypt identically
    const migratedVault = new VaultService(path.join(targetDir, 'vault.db'));
    migratedVault.unlock('MigrationMaster!1');
    expect(migratedVault.getAccountSecret('user@example.com', 'password')).toBe(
      'SecretPassword!123',
    );
    migratedVault.close();

    // Re-running after completion is an idempotent no-op
    const res2 = migrateLegacyUserDataIfNeeded(legacyDir, targetDir);
    expect(res2.migrated).toBe(false);
    expect(res2.reason).toBe('already-migrated');
  });

  it('recovers cleanly when interrupted mid-migration with a corrupted partial file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-mig-resume-'));
    tempDirs.push(root);

    const legacyDir = path.join(root, 'antidetect-app');
    const targetDir = path.join(root, 'Facet');
    fs.mkdirSync(path.join(legacyDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'data', 'antidetect.db'), 'REAL_DB_CONTENT', 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'bridge-pids.json'), '[1234]', 'utf8');

    // Simulate interrupted previous run: partial corrupted file exists, no marker
    fs.mkdirSync(path.join(targetDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'data', 'antidetect.db'), 'CORRUPTED_PARTIAL', 'utf8');

    const res = migrateLegacyUserDataIfNeeded(legacyDir, targetDir);
    expect(res.migrated).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'data', 'antidetect.db'), 'utf8')).toBe(
      'REAL_DB_CONTENT',
    );
    expect(fs.readFileSync(path.join(targetDir, 'bridge-pids.json'), 'utf8')).toBe('[1234]');
    expect(fs.existsSync(path.join(targetDir, MIGRATION_MARKER_FILE))).toBe(true);
  });
});
