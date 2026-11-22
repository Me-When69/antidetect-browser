import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  uninstall,
} from '@puppeteer/browsers';
import type {
  BrowserDownloadProgress,
  BulkVersionPreviewItem,
  ManagedBrowserVersion,
  Profile,
} from '@shared/types';
import { ensureBrowserInstalled, resolveBrowserExecutable } from './browserPath';
import type { AppLogger } from './logger';

const CFT_LAST_KNOWN_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const CFT_KNOWN_GOOD_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json';

export const CHROME_NO_AUTOUPDATE_ARGS: readonly string[] = [
  '--disable-background-networking',
  '--disable-component-update',
  '--no-service-autorun',
  '--disable-sync',
  '--simulate-outdated-no-au=Tue, 31 Dec 2099 23:59:59 GMT',
];

export function compareBrowserVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

export function isVersionDowngrade(
  lastUsedVersion: string | null | undefined,
  targetVersion: string,
): boolean {
  if (!lastUsedVersion || !targetVersion) return false;
  return compareBrowserVersions(targetVersion, lastUsedVersion) < 0;
}

export function previewBulkVersionUpdate(
  profiles: Profile[],
  targetVersion: string,
): BulkVersionPreviewItem[] {
  return profiles.map((p) => {
    const baseline = p.lastBrowserVersion || p.browserVersion;
    const cmp = compareBrowserVersions(targetVersion, baseline);
    const action: BulkVersionPreviewItem['action'] =
      cmp > 0 ? 'upgrade' : cmp < 0 ? 'downgrade' : 'same';
    return {
      profileId: p.id,
      profileName: p.name,
      currentVersion: p.browserVersion,
      targetVersion,
      action,
    };
  });
}

function getDirSizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    try {
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(cur, e.name);
        if (e.isDirectory()) {
          stack.push(full);
        } else if (e.isFile()) {
          total += fs.statSync(full).size;
        }
      }
    } catch {
      // Ignore permission errors
    }
  }
  return total;
}

function httpsGetJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'AntidetectBrowser/1.0' }, timeout: 15_000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as Record<string, unknown>);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout fetching Chrome for Testing versions')));
  });
}

export function detectExecutableVersion(exePath: string): Promise<string> {
  return new Promise((resolve) => {
    if (!exePath || !fs.existsSync(exePath)) {
      resolve('');
      return;
    }
    if (process.platform === 'win32') {
      // Read PE FileVersion cleanly via PowerShell without spawning a Chrome GUI window
      execFile(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-Item '${exePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
        ],
        { timeout: 4000 },
        (err, stdout) => {
          const v = !err ? stdout.trim() : '';
          resolve(/^\d+\.\d+/.test(v) ? v : '');
        },
      );
      return;
    }
    execFile(exePath, ['--version'], { timeout: 4000 }, (err, stdout) => {
      if (err) {
        resolve('');
        return;
      }
      const m = /(\d+\.\d+\.\d+\.\d+|\d+\.\d+)/.exec(stdout);
      resolve(m?.[1] ?? '');
    });
  });
}

export class BrowserManager {
  private chromeCacheDir: string;
  private logger: AppLogger;
  private activeDownloads = new Map<string, { cancelled: boolean }>();

  constructor(browsersRootDir: string, logger: AppLogger) {
    this.chromeCacheDir = path.join(browsersRootDir, 'chrome');
    this.logger = logger;
  }

  getChromeCacheDir(): string {
    return this.chromeCacheDir;
  }

  getExecutableForChromeVersion(version: string): string | null {
    const platform = detectBrowserPlatform();
    if (!platform) return null;
    const versionDir = path.join(this.chromeCacheDir, version);
    try {
      const exe = computeExecutablePath({
        browser: Browser.CHROME,
        buildId: version,
        cacheDir: versionDir,
        platform,
      });
      return fs.existsSync(exe) ? exe : null;
    } catch {
      return null;
    }
  }

  async listInstalledVersions(
    profiles: Profile[],
    customChromePath?: string,
    customCamoufoxPath?: string,
  ): Promise<ManagedBrowserVersion[]> {
    const result: ManagedBrowserVersion[] = [];
    const countByVersion = (kind: string, ver: string): number =>
      profiles.filter((p) => p.browser === kind && p.browserVersion === ver).length;

    // 1. System Chrome / Edge
    try {
      const sys = resolveBrowserExecutable({
        customPath: customChromePath,
        getPlaywrightExecutablePath: () => '',
      });
      const ver = (await detectExecutableVersion(sys.executablePath)) || 'system';
      result.push({
        id: `system:${ver}`,
        browserKind: 'chrome',
        channel: 'system',
        version: ver,
        major: Number(ver.split('.')[0]) || 0,
        installed: true,
        executablePath: sys.executablePath,
        sizeBytes: 0,
        profileCount: countByVersion('chrome', ver),
      });
    } catch {
      // No system Chrome installed
    }

    // 2. Chrome for Testing versions installed under userData/browsers/chrome/<version>
    if (fs.existsSync(this.chromeCacheDir)) {
      const entries = fs.readdirSync(this.chromeCacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const versionDir = path.join(this.chromeCacheDir, entry.name);
        try {
          const installed = await getInstalledBrowsers({ cacheDir: versionDir });
          for (const b of installed) {
            if (b.browser === Browser.CHROME && fs.existsSync(b.executablePath)) {
              result.push({
                id: `cft:${b.buildId}`,
                browserKind: 'chrome',
                channel: 'stable',
                version: b.buildId,
                major: Number(b.buildId.split('.')[0]) || 0,
                installed: true,
                executablePath: b.executablePath,
                sizeBytes: getDirSizeBytes(versionDir),
                profileCount: countByVersion('chrome', b.buildId),
              });
            }
          }
        } catch {
          // Ignore malformed dirs
        }
      }
    }

    // 3. Playwright Firefox / Camoufox
    const ff = ensureBrowserInstalled('firefox', { customPath: customCamoufoxPath });
    if (ff.installed) {
      const ver = (await detectExecutableVersion(ff.executablePath)) || 'playwright-firefox';
      result.push({
        id: `firefox:${ver}`,
        browserKind: 'firefox',
        channel: ff.source === 'camoufox' ? 'camoufox' : 'playwright',
        version: ver,
        major: Number(ver.split('.')[0]) || 0,
        installed: true,
        executablePath: ff.executablePath,
        sizeBytes: getDirSizeBytes(path.dirname(ff.executablePath)),
        profileCount: countByVersion('firefox', ver),
      });
    }

    return result;
  }

  async fetchAvailableChromeVersions(): Promise<ManagedBrowserVersion[]> {
    const items: ManagedBrowserVersion[] = [];
    const seenMajors = new Set<number>();

    // Stable & Beta channels
    const channelsJson = await httpsGetJson(CFT_LAST_KNOWN_URL);
    const channels = (channelsJson['channels'] ?? {}) as Record<
      string,
      { version?: string }
    >;

    for (const ch of ['Stable', 'Beta'] as const) {
      const ver = channels[ch]?.version;
      if (!ver) continue;
      const major = Number(ver.split('.')[0]) || 0;
      seenMajors.add(major);
      const exe = this.getExecutableForChromeVersion(ver);
      items.push({
        id: `cft:${ver}`,
        browserKind: 'chrome',
        channel: ch === 'Stable' ? 'stable' : 'beta',
        version: ver,
        major,
        installed: Boolean(exe),
        executablePath: exe ?? '',
        sizeBytes: exe ? getDirSizeBytes(path.join(this.chromeCacheDir, ver)) : 0,
        profileCount: 0,
      });
    }

    // Last 10 distinct major versions from known-good-versions
    try {
      const knownJson = await httpsGetJson(CFT_KNOWN_GOOD_URL);
      const versions = (knownJson['versions'] ?? []) as { version?: string }[];
      for (let i = versions.length - 1; i >= 0 && seenMajors.size < 12; i -= 1) {
        const ver = versions[i]?.version;
        if (!ver) continue;
        const major = Number(ver.split('.')[0]) || 0;
        if (seenMajors.has(major)) continue;
        seenMajors.add(major);
        const exe = this.getExecutableForChromeVersion(ver);
        items.push({
          id: `cft:${ver}`,
          browserKind: 'chrome',
          channel: 'archive',
          version: ver,
          major,
          installed: Boolean(exe),
          executablePath: exe ?? '',
          sizeBytes: exe ? getDirSizeBytes(path.join(this.chromeCacheDir, ver)) : 0,
          profileCount: 0,
        });
      }
    } catch {
      // Keep Stable/Beta even if full list fails
    }

    return items.sort((a, b) => compareBrowserVersions(b.version, a.version));
  }

  cancelDownload(version: string): void {
    const state = this.activeDownloads.get(version);
    if (state) {
      state.cancelled = true;
    }
  }

  async downloadChromeVersion(
    version: string,
    onProgress: (ev: BrowserDownloadProgress) => void,
  ): Promise<{ ok: boolean; executablePath?: string; error?: string }> {
    if (this.activeDownloads.has(version)) {
      return { ok: false, error: `Đang tải Chrome ${version}, vui lòng chờ.` };
    }

    const platform = detectBrowserPlatform();
    if (!platform) {
      return { ok: false, error: 'Không nhận diện được nền tảng hệ điều hành' };
    }

    const versionDir = path.join(this.chromeCacheDir, version);
    fs.mkdirSync(versionDir, { recursive: true });
    const state = { cancelled: false };
    this.activeDownloads.set(version, state);
    this.logger.info('browserManager', `Downloading Chrome for Testing ${version} into ${versionDir}`);

    try {
      const installed = await install({
        browser: Browser.CHROME,
        buildId: version,
        cacheDir: versionDir,
        platform,
        downloadProgressCallback: (downloadedBytes, totalBytes) => {
          if (state.cancelled) {
            throw new Error('DOWNLOAD_CANCELLED');
          }
          const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          onProgress({ version, percent, downloadedBytes, totalBytes });
        },
      });

      onProgress({ version, percent: 100, downloadedBytes: 1, totalBytes: 1, done: true });
      this.logger.info('browserManager', `Downloaded Chrome ${version}: ${installed.executablePath}`);
      return { ok: true, executablePath: installed.executablePath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'DOWNLOAD_CANCELLED' || state.cancelled) {
        fs.rmSync(versionDir, { recursive: true, force: true });
        onProgress({ version, percent: 0, downloadedBytes: 0, totalBytes: 0, done: true, cancelled: true });
        return { ok: false, error: 'Đã hủy tải phiên bản trình duyệt' };
      }
      this.logger.error('browserManager', `Failed downloading Chrome ${version}: ${msg}`);
      onProgress({ version, percent: 0, downloadedBytes: 0, totalBytes: 0, done: true, error: msg });
      return { ok: false, error: msg };
    } finally {
      this.activeDownloads.delete(version);
    }
  }

  async deleteChromeVersion(version: string): Promise<void> {
    const versionDir = path.join(this.chromeCacheDir, version);
    const platform = detectBrowserPlatform();
    if (platform && fs.existsSync(versionDir)) {
      try {
        await uninstall({
          browser: Browser.CHROME,
          buildId: version,
          cacheDir: versionDir,
          platform,
        });
      } catch {
        // Fallback to direct rmSync
      }
      fs.rmSync(versionDir, { recursive: true, force: true });
    }
    this.logger.info('browserManager', `Deleted Chrome version ${version}`);
  }
}
