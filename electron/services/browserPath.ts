import fs from 'node:fs';
import { chromium } from 'playwright-core';

export type BrowserSource = 'env' | 'custom' | 'chrome' | 'edge' | 'playwright';

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
