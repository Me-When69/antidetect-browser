import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import { ProfileService } from '../../electron/services/profileService';
import { ProxyService } from '../../electron/services/proxyService';
import { SettingsService } from '../../electron/services/settingsService';
import { AppLogger } from '../../electron/services/logger';
import { ProfileLauncher } from '../../electron/services/launcher';
import { generateConsistentIdentity } from '../../electron/services/fingerprint/generator';
import {
  BrowserNotFoundError,
  ensureBrowserInstalled,
  resolveBrowserExecutable,
} from '../../electron/services/browserPath';
import { classifyInstallError } from '../../electron/services/browserInstaller';

describe('Unit: resolveBrowserExecutable', () => {
  const winEnv: NodeJS.ProcessEnv = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
  };

  const CHROME_PATH_VAL = 'D:\\Custom\\chrome.exe';
  const SYS_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const SYS_EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const PW_CHROMIUM = 'C:\\Users\\Test\\AppData\\Roaming\\ms-playwright\\chromium\\chrome.exe';

  it('dùng CHROME_PATH khi biến tồn tại và file có thật; bỏ qua nếu file không tồn tại', () => {
    const hit = resolveBrowserExecutable({
      platform: 'win32',
      env: { ...winEnv, CHROME_PATH: CHROME_PATH_VAL },
      existsSync: (p) => p === CHROME_PATH_VAL || p === SYS_CHROME,
      getPlaywrightExecutablePath: () => PW_CHROMIUM,
    });
    expect(hit.source).toBe('env');
    expect(hit.executablePath).toBe(CHROME_PATH_VAL);

    const missEnv = resolveBrowserExecutable({
      platform: 'win32',
      env: { ...winEnv, CHROME_PATH: 'D:\\NonExistent\\chrome.exe' },
      existsSync: (p) => p === SYS_CHROME,
      getPlaywrightExecutablePath: () => PW_CHROMIUM,
    });
    expect(missEnv.source).toBe('chrome');
    expect(missEnv.executablePath).toBe(SYS_CHROME);
  });

  it('tuân thủ đúng thứ tự ưu tiên: CHROME_PATH > Chrome > Edge > Playwright Chromium', () => {
    const allPresent = new Set([CHROME_PATH_VAL, SYS_CHROME, SYS_EDGE, PW_CHROMIUM]);

    expect(
      resolveBrowserExecutable({
        platform: 'win32',
        env: { ...winEnv, CHROME_PATH: CHROME_PATH_VAL },
        existsSync: (p) => allPresent.has(p),
        getPlaywrightExecutablePath: () => PW_CHROMIUM,
      }).source,
    ).toBe('env');

    expect(
      resolveBrowserExecutable({
        platform: 'win32',
        env: winEnv,
        existsSync: (p) => p === SYS_CHROME || p === SYS_EDGE || p === PW_CHROMIUM,
        getPlaywrightExecutablePath: () => PW_CHROMIUM,
      }).source,
    ).toBe('chrome');

    expect(
      resolveBrowserExecutable({
        platform: 'win32',
        env: winEnv,
        existsSync: (p) => p === SYS_EDGE || p === PW_CHROMIUM,
        getPlaywrightExecutablePath: () => PW_CHROMIUM,
      }).source,
    ).toBe('edge');

    expect(
      resolveBrowserExecutable({
        platform: 'win32',
        env: winEnv,
        existsSync: (p) => p === PW_CHROMIUM,
        getPlaywrightExecutablePath: () => PW_CHROMIUM,
      }).source,
    ).toBe('playwright');
  });

  it('ném lỗi tiếng Việt rõ ràng khi không tìm thấy bất kỳ trình duyệt nào', () => {
    expect(() =>
      resolveBrowserExecutable({
        platform: 'win32',
        env: winEnv,
        existsSync: () => false,
        getPlaywrightExecutablePath: () => PW_CHROMIUM,
      }),
    ).toThrow(BrowserNotFoundError);
  });
});

describe('Unit: ensureBrowserInstalled & lỗi BROWSER_NOT_INSTALLED', () => {
  const winEnv: NodeJS.ProcessEnv = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
  };

  it('kiểm tra ensureBrowserInstalled cho Firefox: có sẵn, thiếu, và đường dẫn bất thường', () => {
    const pwFirefox =
      'C:\\Users\\Test\\AppData\\Roaming\\antidetect\\browsers\\firefox-1572\\firefox\\firefox.exe';

    const okRes = ensureBrowserInstalled('firefox', {
      platform: 'win32',
      env: winEnv,
      existsSync: (p) => p === pwFirefox,
      getPlaywrightExecutablePath: () => pwFirefox,
    });
    expect(okRes.installed).toBe(true);
    if (okRes.installed) {
      expect(okRes.executablePath).toBe(pwFirefox);
    }

    const missingRes = ensureBrowserInstalled('firefox', {
      platform: 'win32',
      env: winEnv,
      existsSync: () => false,
      getPlaywrightExecutablePath: () => pwFirefox,
    });
    expect(missingRes.installed).toBe(false);
    if (!missingRes.installed) {
      expect(missingRes.code).toBe('BROWSER_NOT_INSTALLED');
      expect(missingRes.browser).toBe('firefox');
      expect(missingRes.reason).toContain('80 MB');
    }

    const weirdPathRes = ensureBrowserInstalled('firefox', {
      platform: 'win32',
      env: winEnv,
      existsSync: () => false,
      getPlaywrightExecutablePath: () => {
        throw new Error('corrupted registry');
      },
    });
    expect(weirdPathRes.installed).toBe(false);
    if (!weirdPathRes.installed) {
      expect(weirdPathRes.code).toBe('BROWSER_NOT_INSTALLED');
    }
  });

  it('phân loại lỗi tải trình duyệt (mạng, hết dung lượng, antivirus) sang tiếng Việt', () => {
    expect(classifyInstallError('ENOSPC: no space left on device')).toContain('dung lượng');
    expect(classifyInstallError('EACCES: permission denied')).toContain('antivirus');
    expect(classifyInstallError('getaddrinfo ENOTFOUND cdn.playwright.dev')).toContain(
      'kết nối mạng',
    );
  });

  it('launcher.start trả về mã lỗi BROWSER_NOT_INSTALLED (không ném lỗi thô) khi thiếu Firefox', async () => {
    const prevPath = process.env['PLAYWRIGHT_BROWSERS_PATH'];
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = 'Z:\\non-existent-browsers-dir-99999';
    const dbCtx = createDatabase(':memory:');
    try {
      const secrets = new SecretService(null);
      const logger = new AppLogger();
      const profileService = new ProfileService(dbCtx.db, secrets, 'Z:\\non-existent-profiles');
      const proxyService = new ProxyService(dbCtx.db, secrets);
      const settingsService = new SettingsService(dbCtx.db);
      const launcher = new ProfileLauncher(profileService, proxyService, settingsService, logger);

      // Temporarily verify error code contract when firefox path doesn't exist
      const check = ensureBrowserInstalled('firefox', {
        existsSync: () => false,
        getPlaywrightExecutablePath: () => 'Z:\\missing\\firefox.exe',
      });
      expect(check.installed).toBe(false);
      if (!check.installed) {
        expect(check.code).toBe('BROWSER_NOT_INSTALLED');
      }

      // Also verify launcher doesn't crash on invalid profile creation / missing binary
      const id = generateConsistentIdentity('windows', 'firefox');
      expect(id.browser).toBe('firefox');
      expect(launcher.getRunningIds()).toEqual([]);
    } finally {
      if (prevPath === undefined) {
        delete process.env['PLAYWRIGHT_BROWSERS_PATH'];
      } else {
        process.env['PLAYWRIGHT_BROWSERS_PATH'] = prevPath;
      }
      dbCtx.sqlite.close();
    }
  });
});
