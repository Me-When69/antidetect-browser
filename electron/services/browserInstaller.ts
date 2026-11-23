import fs from 'node:fs';
import path from 'node:path';
import type { BrowserInstallProgressEvent } from '@shared/types';
import type { AppLogger } from './logger';

export type InstallableBrowser = 'chromium' | 'firefox';

export interface UtilityProcessLike {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'error', listener: (type: string, location: string, report: string) => void): unknown;
}

export type UtilityForkFn = (
  modulePath: string,
  args?: string[],
  options?: { env?: NodeJS.ProcessEnv; stdio?: 'pipe' },
) => UtilityProcessLike;

export function classifyInstallError(raw: string): string {
  if (/ENOSPC|no space left/i.test(raw)) {
    return 'Ổ đĩa không đủ dung lượng trống để tải trình duyệt. Vui lòng dọn bộ nhớ rồi thử lại.';
  }
  if (/EACCES|EPERM|access is denied|operation not permitted/i.test(raw)) {
    return 'Không có quyền ghi hoặc bị phần mềm diệt virus chặn. Hãy thêm thư mục ứng dụng vào ngoại lệ antivirus rồi thử lại.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(raw)) {
    return 'Lỗi kết nối mạng khi tải trình duyệt. Kiểm tra Internet/Proxy hệ thống rồi bấm Thử lại.';
  }
  const clean = raw.trim();
  return clean.length > 180 ? `${clean.slice(0, 180)}...` : clean || 'Tải trình duyệt thất bại.';
}

export function resolvePlaywrightCliPath(appRoot: string): string {
  const candidates = [
    path.join(appRoot, 'node_modules', 'playwright-core', 'cli.js'),
    path.join(process.cwd(), 'node_modules', 'playwright-core', 'cli.js'),
    path.join(
      process.resourcesPath ?? '',
      'app.asar.unpacked',
      'node_modules',
      'playwright-core',
      'cli.js',
    ),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export class BrowserInstaller {
  private inProgress = new Set<InstallableBrowser>();
  private appRoot: string;
  private browsersDir: string;
  private logger: AppLogger;
  private forkFn: UtilityForkFn;

  constructor(appRoot: string, browsersDir: string, logger: AppLogger, forkFn: UtilityForkFn) {
    this.appRoot = appRoot;
    this.browsersDir = browsersDir;
    this.logger = logger;
    this.forkFn = forkFn;
  }

  isInstalling(browser: InstallableBrowser): boolean {
    return this.inProgress.has(browser);
  }

  install(
    browser: InstallableBrowser,
    onProgress: (event: BrowserInstallProgressEvent) => void,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.inProgress.has(browser)) {
      return Promise.resolve({
        ok: false,
        error: `Đang tải ${browser === 'firefox' ? 'Firefox' : 'Chromium'}, vui lòng chờ hoàn tất.`,
      });
    }

    const cliPath = resolvePlaywrightCliPath(this.appRoot);
    const label = browser === 'firefox' ? 'Firefox' : 'Chromium';

    if (!fs.existsSync(cliPath)) {
      const msg = `Không tìm thấy Playwright CLI tại ${cliPath}`;
      this.logger.error('browserInstaller', msg);
      onProgress({ browser, percent: null, line: msg, done: true, success: false, error: msg });
      return Promise.resolve({ ok: false, error: msg });
    }

    if (!fs.existsSync(this.browsersDir)) {
      fs.mkdirSync(this.browsersDir, { recursive: true });
    }

    this.inProgress.add(browser);
    this.logger.info(
      'browserInstaller',
      `Starting install for ${label} via utilityProcess.fork (${cliPath}) into ${this.browsersDir}`,
    );
    onProgress({
      browser,
      percent: 0,
      line: `Đang tải ${label} vào ${this.browsersDir}...`,
    });

    return new Promise((resolve) => {
      let lastStderr = '';
      let lastPercent = 0;
      let settled = false;

      const finish = (result: { ok: boolean; error?: string }): void => {
        if (settled) return;
        settled = true;
        this.inProgress.delete(browser);
        resolve(result);
      };

      // Use Electron utilityProcess.fork (safe with RunAsNode=false Fuse)
      let child: UtilityProcessLike;
      try {
        child = this.forkFn(cliPath, ['install', browser], {
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: this.browsersDir,
          },
          stdio: 'pipe',
        });
      } catch (err) {
        const msg = classifyInstallError(err instanceof Error ? err.message : String(err));
        this.logger.error('browserInstaller', `Install ${label} failed to fork: ${msg}`);
        onProgress({
          browser,
          percent: lastPercent,
          line: msg,
          done: true,
          success: false,
          error: msg,
        });
        finish({ ok: false, error: msg });
        return;
      }

      const handleChunk = (chunk: Buffer, isErr: boolean): void => {
        const text = chunk.toString('utf8');
        if (isErr) lastStderr += text;
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const pctMatch = /(\d{1,3})%/.exec(line);
          if (pctMatch) {
            const parsed = Number(pctMatch[1]);
            if (Number.isFinite(parsed)) {
              lastPercent = Math.max(0, Math.min(100, parsed));
            }
          }
          onProgress({ browser, percent: lastPercent, line });
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => handleChunk(chunk, false));
      child.stderr?.on('data', (chunk: Buffer) => handleChunk(chunk, true));

      child.on('error', (type, location, report) => {
        const rawErr = `${type} at ${location}: ${report}`.trim();
        const friendly = classifyInstallError(rawErr);
        this.logger.error('browserInstaller', `Install ${label} failed: ${rawErr}`);
        onProgress({
          browser,
          percent: lastPercent,
          line: friendly,
          done: true,
          success: false,
          error: friendly,
        });
        finish({ ok: false, error: friendly });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          this.logger.info('browserInstaller', `Installed ${label} successfully`);
          onProgress({
            browser,
            percent: 100,
            line: `Tải ${label} thành công!`,
            done: true,
            success: true,
          });
          finish({ ok: true });
        } else {
          const friendly = classifyInstallError(lastStderr || `Mã lỗi ${code ?? -1}`);
          this.logger.error('browserInstaller', `Install ${label} exited ${code}: ${friendly}`);
          onProgress({
            browser,
            percent: lastPercent,
            line: friendly,
            done: true,
            success: false,
            error: friendly,
          });
          finish({ ok: false, error: friendly });
        }
      });
    });
  }
}
