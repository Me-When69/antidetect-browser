import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { ProfileService } from '../../electron/services/profileService';
import { SecretService } from '../../electron/services/secretService';

describe('Security Hardening Regression Tests (E-001+)', () => {
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

  it('E-001: rejects path traversal in getProfileDir and permanentDelete without deleting external folders', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-e001-'));
    tempDirs.push(baseDir);

    const profilesDir = path.join(baseDir, 'profiles');
    const victimDir = path.join(baseDir, 'victim-outside');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.mkdirSync(victimDir, { recursive: true });
    fs.writeFileSync(path.join(victimDir, 'keep.txt'), 'safe', 'utf8');

    const dbCtx = createDatabase(path.join(baseDir, 'antidetect.db'));
    const svc = new ProfileService(dbCtx.db, new SecretService(), profilesDir);

    expect(() => svc.getProfileDir('../victim-outside')).toThrow();
    expect(() => svc.getProfileDir('..\\victim-outside')).toThrow();
    expect(() => svc.getProfileDir('nested/id')).toThrow();
    expect(() => svc.permanentDelete('../victim-outside')).toThrow();

    // Victim directory outside profilesRootDir MUST remain untouched
    expect(fs.existsSync(path.join(victimDir, 'keep.txt'))).toBe(true);

    // Valid UUID / safe ID still resolves cleanly inside profilesRootDir
    const validDir = svc.getProfileDir('550e8400-e29b-41d4-a716-446655440000');
    expect(validDir.startsWith(path.resolve(profilesDir) + path.sep)).toBe(true);

    dbCtx.sqlite.close();
  });
});
