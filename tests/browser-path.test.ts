import { describe, expect, it } from 'vitest';
import { BrowserNotFoundError, resolveBrowserExecutable } from '../electron/services/browserPath';

describe('resolveBrowserExecutable (mocked fs.existsSync & env)', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
  };

  it('prefers CHROME_PATH environment variable when it exists', () => {
    const customEnvPath = 'D:\\PortableChrome\\chrome.exe';
    const result = resolveBrowserExecutable({
      platform: 'win32',
      env: { ...baseEnv, CHROME_PATH: customEnvPath },
      existsSync: (p) => p === customEnvPath,
      getPlaywrightExecutablePath: () => 'C:\\pw\\chrome.exe',
    });

    expect(result.source).toBe('env');
    expect(result.executablePath).toBe(customEnvPath);
  });

  it('finds installed Google Chrome when CHROME_PATH is not set', () => {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const result = resolveBrowserExecutable({
      platform: 'win32',
      env: baseEnv,
      existsSync: (p) => p === chromePath,
      getPlaywrightExecutablePath: () => 'C:\\pw\\chrome.exe',
    });

    expect(result.source).toBe('chrome');
    expect(result.label).toBe('Google Chrome');
    expect(result.executablePath).toBe(chromePath);
  });

  it('falls back to Microsoft Edge when only Edge is installed', () => {
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const result = resolveBrowserExecutable({
      platform: 'win32',
      env: baseEnv,
      existsSync: (p) => p === edgePath,
      getPlaywrightExecutablePath: () => 'C:\\pw\\chrome.exe',
    });

    expect(result.source).toBe('edge');
    expect(result.label).toBe('Microsoft Edge');
    expect(result.executablePath).toBe(edgePath);
  });

  it('falls back to Playwright Chromium when only Playwright binary exists on disk', () => {
    const pwPath =
      'C:\\Users\\Test\\AppData\\Roaming\\antidetect\\ms-playwright\\chromium\\chrome.exe';
    const result = resolveBrowserExecutable({
      platform: 'win32',
      env: baseEnv,
      existsSync: (p) => p === pwPath,
      getPlaywrightExecutablePath: () => pwPath,
    });

    expect(result.source).toBe('playwright');
    expect(result.label).toBe('Playwright Chromium');
    expect(result.executablePath).toBe(pwPath);
  });

  it('throws BrowserNotFoundError with Vietnamese message when no browser exists', () => {
    expect(() =>
      resolveBrowserExecutable({
        platform: 'win32',
        env: baseEnv,
        existsSync: () => false,
        getPlaywrightExecutablePath: () => 'C:\\missing\\chrome.exe',
      }),
    ).toThrow(BrowserNotFoundError);

    expect(() =>
      resolveBrowserExecutable({
        platform: 'win32',
        env: baseEnv,
        existsSync: () => false,
        getPlaywrightExecutablePath: () => 'C:\\missing\\chrome.exe',
      }),
    ).toThrow("Không tìm thấy Chrome. Hãy cài Google Chrome hoặc bấm 'Tải Chromium'");
  });
});
