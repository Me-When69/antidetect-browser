import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright-core';
import type { BrowserInventoryItem } from '@shared/types';

export type BrowserSource = 'env' | 'custom' | 'chrome' | 'edge' | 'playwright' | 'camoufox';

export type EnsureBrowserResult =
  | {
      installed: true;
      browser: 'chromium' | 'firefox';
      executablePath: string;
      source: BrowserSource;
      label: string;
    }
  | {
      installed: false;
      code: 'BROWSER_NOT_INSTALLED';
      browser: 'chromium' | 'firefox';
      expectedPath: string;
      reason: string;
    };

export interface ResolvedBrowser {
  executablePath: string;
  source: BrowserSource;
  label: string;
}

export class BrowserNotFoundError extends Error {
  readonly code = 'BROWSER_NOT_FOUND';

  constructor(message = "Không tìm thấy Chrome. Hãy cài Google Chrome hoặc bấm 'Tải Chromium'") {
    super(message);
    this.name = 'BrowserNotFoundError';
  }
}

export interface ResolveBrowserOptions {
  customPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (p: string) => boolean;
  getPlaywrightExecutablePath?: () => string;
}

function getChromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const programFiles = env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const programFilesX86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = env['LOCALAPPDATA'] ?? '';
    return [
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      ...(localAppData ? [`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`] : []),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

function getEdgeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const programFiles = env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const programFilesX86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = env['LOCALAPPDATA'] ?? '';
    return [
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ...(localAppData ? [`${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`] : []),
    ];
  }
  if (platform === 'darwin') {
    return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  }
  return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
}

export function resolveBrowserExecutable(options: ResolveBrowserOptions = {}): ResolvedBrowser {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? fs.existsSync;
  const getPwPath = options.getPlaywrightExecutablePath ?? (() => chromium.executablePath());

  // 1. CHROME_PATH environment variable
  const envChromePath = env['CHROME_PATH']?.trim();
  if (envChromePath && exists(envChromePath)) {
    return {
      executablePath: envChromePath,
      source: 'env',
      label: 'CHROME_PATH (Env)',
    };
  }

  // 2. Custom path configured in Settings
  const custom = options.customPath?.trim();
  if (custom && exists(custom)) {
    return {
      executablePath: custom,
      source: 'custom',
      label: 'Custom Chrome',
    };
  }

  // 3. Installed Google Chrome
  for (const candidate of getChromeCandidates(platform, env)) {
    if (candidate && exists(candidate)) {
      return {
        executablePath: candidate,
        source: 'chrome',
        label: 'Google Chrome',
      };
    }
  }

  // 4. Installed Microsoft Edge (Chromium)
  for (const candidate of getEdgeCandidates(platform, env)) {
    if (candidate && exists(candidate)) {
      return {
        executablePath: candidate,
        source: 'edge',
        label: 'Microsoft Edge',
      };
    }
  }

  // 5. Playwright-managed Chromium (only if binary actually exists on disk)
  try {
    const pwPath = getPwPath();
    if (pwPath && exists(pwPath)) {
      return {
        executablePath: pwPath,
        source: 'playwright',
        label: 'Playwright Chromium',
      };
    }
  } catch {
    // Ignore if Playwright cannot resolve path
  }

  throw new BrowserNotFoundError();
}

export function resolveFirefoxExecutable(options: ResolveBrowserOptions = {}): ResolvedBrowser {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? fs.existsSync;
  const getPwFirefoxPath = options.getPlaywrightExecutablePath ?? (() => firefox.executablePath());

  // 1. CAMOUFOX_BINARY env var
  const envBin = env['CAMOUFOX_BINARY']?.trim();
  if (envBin && exists(envBin)) {
    return { executablePath: envBin, source: 'env', label: 'CAMOUFOX_BINARY (Env)' };
  }

  // 2. Custom path from Settings
  const custom = options.customPath?.trim();
  if (custom && exists(custom)) {
    return { executablePath: custom, source: 'custom', label: 'Custom Camoufox / Firefox' };
  }

  // 3. Default Camoufox install locations
  const home = os.homedir();
  const camoufoxCandidates: string[] = [];
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    camoufoxCandidates.push(
      path.join(localAppData, 'camoufox', 'camoufox', 'Cache', 'camoufox.exe'),
    );
  } else if (platform === 'darwin') {
    camoufoxCandidates.push(
      path.join(
        home,
        'Library',
        'Caches',
        'camoufox',
        'Camoufox.app',
        'Contents',
        'MacOS',
        'camoufox',
      ),
    );
  } else {
    camoufoxCandidates.push(path.join(home, '.cache', 'camoufox', 'camoufox'));
  }

  for (const candidate of camoufoxCandidates) {
    if (candidate && exists(candidate)) {
      return { executablePath: candidate, source: 'camoufox', label: 'Camoufox' };
    }
  }

  // 4. Playwright-managed Firefox (check active PLAYWRIGHT_BROWSERS_PATH, then default %LOCALAPPDATA%\ms-playwright)
  try {
    const pwPath = getPwFirefoxPath();
    if (pwPath && exists(pwPath)) {
      return { executablePath: pwPath, source: 'playwright', label: 'Playwright Firefox' };
    }
    if (platform === 'win32' && pwPath) {
      const localAppData = env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
      const idx = pwPath.toLowerCase().indexOf('ms-playwright');
      if (idx >= 0) {
        const defaultPwPath = path.join(localAppData, pwPath.slice(idx));
        if (exists(defaultPwPath)) {
          return {
            executablePath: defaultPwPath,
            source: 'playwright',
            label: 'Playwright Firefox',
          };
        }
      }
    }
  } catch {
    // Ignore if Playwright cannot resolve path
  }

  throw new BrowserNotFoundError(
    'Cần tải Firefox cho Playwright (khoảng 80 MB). Bạn có muốn tải bây giờ không?',
  );
}

export function ensureBrowserInstalled(
  browser: 'chromium' | 'firefox',
  options: ResolveBrowserOptions = {},
): EnsureBrowserResult {
  const exists = options.existsSync ?? fs.existsSync;

  if (browser === 'chromium') {
    try {
      const resolved = resolveBrowserExecutable(options);
      return {
        installed: true,
        browser: 'chromium',
        executablePath: resolved.executablePath,
        source: resolved.source,
        label: resolved.label,
      };
    } catch {
      let expectedPath = '';
      try {
        expectedPath = (options.getPlaywrightExecutablePath ?? (() => chromium.executablePath()))();
      } catch {
        expectedPath = '';
      }
      return {
        installed: false,
        code: 'BROWSER_NOT_INSTALLED',
        browser: 'chromium',
        expectedPath,
        reason: "Không tìm thấy Chrome. Hãy cài Google Chrome hoặc bấm 'Tải về' để tải Chromium.",
      };
    }
  }

  // Firefox: only Camoufox (if configured) or Playwright's patched Firefox (never system stock Firefox)
  try {
    const resolved = resolveFirefoxExecutable(options);
    return {
      installed: true,
      browser: 'firefox',
      executablePath: resolved.executablePath,
      source: resolved.source,
      label: resolved.label,
    };
  } catch {
    let expectedPath = '';
    try {
      const raw = (options.getPlaywrightExecutablePath ?? (() => firefox.executablePath()))();
      expectedPath = typeof raw === 'string' && raw.trim() && exists(raw) ? raw : (raw ?? '');
    } catch {
      expectedPath = '';
    }
    return {
      installed: false,
      code: 'BROWSER_NOT_INSTALLED',
      browser: 'firefox',
      expectedPath,
      reason: 'Cần tải Firefox cho Playwright (khoảng 80 MB). Bạn có muốn tải bây giờ không?',
    };
  }
}

export function listInstalledBrowsers(
  customChromePath?: string,
  customCamoufoxPath?: string,
): BrowserInventoryItem[] {
  const items: BrowserInventoryItem[] = [];

  // 1. System Chrome / Edge
  let sysPath = '';
  let sysLabel = 'Chrome / Edge hệ thống';
  try {
    const res = resolveBrowserExecutable({
      customPath: customChromePath,
      getPlaywrightExecutablePath: () => '',
    });
    sysPath = res.executablePath;
    sysLabel = res.label;
  } catch {
    sysPath = '';
  }
  items.push({
    id: 'system-chrome',
    name: sysLabel,
    installed: Boolean(sysPath),
    executablePath: sysPath,
    version: sysPath ? 'System' : '—',
  });

  // 2. Playwright Chromium
  let pwChromePath = '';
  try {
    pwChromePath = chromium.executablePath();
  } catch {
    pwChromePath = '';
  }
  const pwChromeInstalled = Boolean(pwChromePath && fs.existsSync(pwChromePath));
  const pwChromeRev = /chromium-(\d+)/i.exec(pwChromePath)?.[1];
  items.push({
    id: 'playwright-chromium',
    name: 'Playwright Chromium',
    installed: pwChromeInstalled,
    executablePath: pwChromePath,
    version: pwChromeRev ? `rev-${pwChromeRev}` : 'Playwright',
    installableTarget: 'chromium',
  });

  // 3. Playwright Firefox / Camoufox
  const ffCheck = ensureBrowserInstalled('firefox', { customPath: customCamoufoxPath });
  const ffPath = ffCheck.installed ? ffCheck.executablePath : ffCheck.expectedPath;
  const ffRev = /firefox-(\d+)/i.exec(ffPath)?.[1];
  items.push({
    id: 'playwright-firefox',
    name: ffCheck.installed ? ffCheck.label : 'Playwright Firefox',
    installed: ffCheck.installed,
    executablePath: ffPath,
    version: ffRev ? `rev-${ffRev}` : 'Playwright',
    installableTarget: 'firefox',
  });

  return items;
}
