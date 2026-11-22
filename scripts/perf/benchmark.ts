import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import { ProfileService } from '../../electron/services/profileService';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import { applyDevice, listDevices } from '../../electron/services/deviceCatalog';
import { checkIdentityConsistency } from '../../shared/validation';
import type { CreateProfileInput } from '../../shared/types';

function dirSizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else {
      try {
        total += fs.statSync(full).size;
      } catch {
        // ignore
      }
    }
  }
  return total;
}

function listFilesWithSizes(dirPath: string): { file: string; bytes: number }[] {
  if (!fs.existsSync(dirPath)) return [];
  const results: { file: string; bytes: number }[] = [];
  const walk = (curr: string): void => {
    for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
      const full = path.join(curr, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push({ file: path.relative(dirPath, full), bytes: fs.statSync(full).size });
    }
  };
  walk(dirPath);
  return results.sort((a, b) => b.bytes - a.bytes);
}

function makeFakeProfile(idx: number, folderId: string | null): CreateProfileInput {
  const platforms = ['windows', 'macos', 'linux', 'android'] as const;
  const platform = platforms[idx % platforms.length]!;
  const devices = listDevices(platform);
  const dev = devices[idx % devices.length]!;
  const base: CreateProfileInput = {
    name: `Bench-Profile-${String(idx).padStart(4, '0')}`,
    folderId,
    status: (['none', 'ready', 'active', 'warming', 'banned'] as const)[idx % 5]!,
    tags: [`tag-${idx % 10}`, idx % 2 === 0 ? 'ecom' : 'qa'],
    notes: `Synthetic benchmark profile #${idx}`,
    platform,
    osVersion: dev.osVersion,
    browser: 'chrome',
    browserVersion: '136.0.0.0',
    userAgent: 'auto',
    proxy: {
      type: idx % 3 === 0 ? 'none' : 'http',
      host: idx % 3 === 0 ? '' : `198.51.100.${(idx % 250) + 1}`,
      port: idx % 3 === 0 ? 0 : 8000 + (idx % 100),
      username: '',
      password: '',
    },
    ipv6Policy: 'block',
    geo: { mode: 'manual', timezone: 'UTC', language: 'en-US', lat: null, lon: null },
    fingerprint: {
      screen: { width: 1920, height: 1080, dpr: 1 },
      hardware: { cores: 8, memory: 16 },
      webgl: { vendor: 'Google Inc.', renderer: 'ANGLE' },
      canvasNoiseSeed: 10000 + idx,
      audioNoiseSeed: 20000 + idx,
      fonts: ['Arial'],
      webrtc: 'replace',
    },
    startup: { urls: [], restoreTabs: false },
  };
  return applyDevice(base, dev, '136.0.0.0');
}

function main(): void {
  const appRoot = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  // 1. Bundle & node_modules sizes
  const distBytes = dirSizeBytes(path.join(appRoot, 'dist'));
  const distElectronBytes = dirSizeBytes(path.join(appRoot, 'dist-electron'));
  const distFiles = listFilesWithSizes(path.join(appRoot, 'dist'));
  const mainFiles = listFilesWithSizes(path.join(appRoot, 'dist-electron'));
  const nodeModulesDir = path.join(appRoot, 'node_modules');
  const topNodeModules = fs.existsSync(nodeModulesDir)
    ? fs
        .readdirSync(nodeModulesDir)
        .filter((n) => !n.startsWith('.'))
        .map((n) => ({ name: n, bytes: dirSizeBytes(path.join(nodeModulesDir, n)) }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 15)
    : [];

  // 2. Fingerprint generation benchmark (100 iterations)
  const fpStart = performance.now();
  for (let i = 0; i < 100; i += 1) {
    generateConsistentIdentity('windows', 'chrome');
  }
  const fpAvgMs = (performance.now() - fpStart) / 100;

  // 3. Consistency check benchmark (100 iterations)
  const sampleProfile = makeFakeProfile(1, null);
  const ccStart = performance.now();
  for (let i = 0; i < 100; i += 1) {
    checkIdentityConsistency(sampleProfile, null, {
      realEngineVersion: '136.0.0.0',
      browser: 'chrome',
    });
  }
  const ccAvgMs = (performance.now() - ccStart) / 100;

  // 4. SQLite 100 & 1000 profile benchmarks
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-perf-'));
  const dbPath = path.join(tmpDir, 'perf.db');
  const dbCtx = createDatabase(dbPath);
  const secrets = new SecretService(null);
  const svc = new ProfileService(dbCtx.db, secrets, path.join(tmpDir, 'profiles'));

  const folderA = svc.createFolder('Ecom');
  const folderB = svc.createFolder('QA');

  const insert100Start = performance.now();
  for (let i = 0; i < 100; i += 1) {
    svc.create(makeFakeProfile(i, i % 2 === 0 ? folderA.id : folderB.id));
  }
  const insert100Ms = performance.now() - insert100Start;

  const list100Start = performance.now();
  const list100 = svc.list();
  const list100Ms = performance.now() - list100Start;
  const heap100Mb = process.memoryUsage().heapUsed / (1024 * 1024);

  const insert900Start = performance.now();
  for (let i = 100; i < 1000; i += 1) {
    svc.create(makeFakeProfile(i, i % 2 === 0 ? folderA.id : folderB.id));
  }
  const insert900Ms = performance.now() - insert900Start;

  const list1000Start = performance.now();
  const list1000 = svc.list();
  const list1000Ms = performance.now() - list1000Start;

  const searchStart = performance.now();
  const searchRes = svc.list({ search: '0420', status: 'none', sortBy: 'name', sortDir: 'asc' });
  const searchMs = performance.now() - searchStart;

  const folderFilterStart = performance.now();
  const folderRes = svc.list({ folderId: folderA.id, sortBy: 'lastRunAt', sortDir: 'desc' });
  const folderFilterMs = performance.now() - folderFilterStart;

  const bulkIds = list1000.slice(0, 50).map((p) => p.id);
  const bulkStart = performance.now();
  svc.bulkUpdate({ ids: bulkIds, status: 'ready' });
  const bulkUpdate50Ms = performance.now() - bulkStart;

  const explainList = dbCtx.sqlite
    .prepare("EXPLAIN QUERY PLAN SELECT * FROM profiles WHERE deleted_at IS NULL AND folder_id = ? ORDER BY created_at DESC")
    .all(folderA.id);

  const heap1000Mb = process.memoryUsage().heapUsed / (1024 * 1024);
  const rssMb = process.memoryUsage().rss / (1024 * 1024);

  dbCtx.sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const report = {
    timestamp: new Date().toISOString(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpus: os.cpus().length,
      totalRamGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    },
    dependencies: {
      directDeps: Object.keys(pkg.dependencies).length,
      devDeps: Object.keys(pkg.devDependencies).length,
      topNodeModulesMb: topNodeModules.map((m) => ({
        name: m.name,
        mb: Number((m.bytes / (1024 * 1024)).toFixed(2)),
      })),
    },
    bundles: {
      distTotalKb: Number((distBytes / 1024).toFixed(1)),
      distElectronTotalKb: Number((distElectronBytes / 1024).toFixed(1)),
      topDistFilesKb: distFiles.slice(0, 10).map((f) => ({
        file: f.file,
        kb: Number((f.bytes / 1024).toFixed(1)),
      })),
      mainFilesKb: mainFiles.map((f) => ({
        file: f.file,
        kb: Number((f.bytes / 1024).toFixed(1)),
      })),
    },
    timingsMs: {
      fingerprintGenAvg: Number(fpAvgMs.toFixed(3)),
      consistencyCheckAvg: Number(ccAvgMs.toFixed(3)),
      sqliteInsert100: Number(insert100Ms.toFixed(1)),
      sqliteList100: Number(list100Ms.toFixed(2)),
      sqliteInsert900: Number(insert900Ms.toFixed(1)),
      sqliteList1000: Number(list1000Ms.toFixed(2)),
      sqliteSearchFilterSort1000: Number(searchMs.toFixed(2)),
      sqliteFolderFilter1000: Number(folderFilterMs.toFixed(2)),
      sqliteBulkUpdate50: Number(bulkUpdate50Ms.toFixed(1)),
    },
    counts: {
      list100: list100.length,
      list1000: list1000.length,
      searchMatches: searchRes.length,
      folderMatches: folderRes.length,
    },
    memoryMb: {
      heapAfter100: Number(heap100Mb.toFixed(1)),
      heapAfter1000: Number(heap1000Mb.toFixed(1)),
      rss: Number(rssMb.toFixed(1)),
    },
    explainPlan: explainList,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
