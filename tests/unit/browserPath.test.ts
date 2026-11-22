import { describe, expect, it } from 'vitest';
import {
  BrowserNotFoundError,
  resolveBrowserExecutable,
} from '../../electron/services/browserPath';

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
