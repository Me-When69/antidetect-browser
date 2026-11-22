import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import type { ProfileProxy, ProxyCoreDownloadProgress, ProxyCoreInfo } from '@shared/types';
import type { AppLogger } from './logger';

export type ExternalCoreName = 'sing-box' | 'xray';

function getBinaryFileName(core: ExternalCoreName): string {
  return process.platform === 'win32' ? `${core}.exe` : core;
}

function execVersion(exePath: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(exePath, args, { timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve('unknown');
        return;
      }
      const firstLine = stdout.split(/\r?\n/).find((l) => l.trim().length > 0) ?? 'installed';
      resolve(firstLine.trim().slice(0, 60));
    });
  });
}

function classifyDownloadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/EACCES|EPERM|access is denied/i.test(msg)) {
    return 'Không có quyền ghi hoặc bị antivirus chặn khi tải lõi proxy.';
  }
  if (/ENOSPC/i.test(msg)) {
    return 'Ổ đĩa không đủ dung lượng trống để tải lõi proxy.';
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return 'Lỗi kết nối mạng khi tải lõi proxy. Kiểm tra Internet rồi thử lại.';
  }
  return msg.slice(0, 160) || 'Không thể tải lõi proxy.';
}

function httpsGetJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'AntidetectBrowser/1.0', Accept: 'application/json' } },
      (res) => {
        if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400 && res.headers.location) {
          void httpsGetJson(res.headers.location).then(resolve, reject);
          return;
        }
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
  });
}

function downloadFileWithProgress(
  url: string,
  destPath: string,
  onPct: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'AntidetectBrowser/1.0' } }, (res) => {
      if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400 && res.headers.location) {
        void downloadFileWithProgress(res.headers.location, destPath, onPct).then(resolve, reject);
        return;
      }
      if ((res.statusCode ?? 500) >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length'] ?? '0');
      let received = 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        hash.update(chunk);
        if (total > 0) {
          onPct(Math.min(100, Math.round((received / total) * 100)));
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => resolve(hash.digest('hex')));
      });
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

function buildSingleSingBoxOutbound(
  proxy: ProfileProxy,
  tag: string,
  detour?: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = { tag, server: proxy.host, server_port: proxy.port };
  if (detour) base['detour'] = detour;

  switch (proxy.type) {
    case 'shadowsocks':
      return {
        ...base,
        type: 'shadowsocks',
        method: proxy.extra?.['cipher'] || 'aes-256-gcm',
        password: proxy.password,
      };
    case 'vmess': {
      const tlsEnabled = proxy.extra?.['tls'] === 'tls' || proxy.extra?.['tls'] === 'true';
      const net = proxy.extra?.['network'] || 'tcp';
      return {
        ...base,
        type: 'vmess',
        uuid: proxy.extra?.['uuid'] || '',
        security: proxy.extra?.['security'] || 'auto',
        ...(tlsEnabled
          ? { tls: { enabled: true, server_name: proxy.extra?.['sni'] || proxy.host } }
          : {}),
        ...(net === 'ws'
          ? { transport: { type: 'ws', path: proxy.extra?.['path'] || '/' } }
          : {}),
      };
    }
    case 'vless': {
      const tlsEnabled = proxy.extra?.['tls'] === 'tls' || proxy.extra?.['tls'] === 'reality';
      const net = proxy.extra?.['network'] || 'tcp';
      return {
        ...base,
        type: 'vless',
        uuid: proxy.extra?.['uuid'] || '',
        ...(proxy.extra?.['flow'] ? { flow: proxy.extra['flow'] } : {}),
        ...(tlsEnabled
          ? { tls: { enabled: true, server_name: proxy.extra?.['sni'] || proxy.host } }
          : {}),
        ...(net === 'ws'
          ? { transport: { type: 'ws', path: proxy.extra?.['path'] || '/' } }
          : {}),
      };
    }
    case 'trojan': {
      const net = proxy.extra?.['network'] || 'tcp';
      return {
        ...base,
        type: 'trojan',
        password: proxy.password,
        tls: { enabled: true, server_name: proxy.extra?.['sni'] || proxy.host },
        ...(net === 'ws'
          ? { transport: { type: 'ws', path: proxy.extra?.['path'] || '/' } }
          : {}),
      };
    }
    case 'socks5':
    case 'socks5h':
      return {
        ...base,
        type: 'socks',
        version: '5',
        ...(proxy.username ? { username: proxy.username, password: proxy.password } : {}),
      };
    case 'socks4':
    case 'socks4a':
      return {
        ...base,
        type: 'socks',
        version: '4a',
        ...(proxy.username ? { username: proxy.username } : {}),
      };
    case 'http':
    case 'https':
    default:
      return {
        ...base,
        type: 'http',
        ...(proxy.username ? { username: proxy.username, password: proxy.password } : {}),
        ...(proxy.type === 'https' ? { tls: { enabled: true, server_name: proxy.host } } : {}),
      };
  }
}

export function buildSingBoxConfig(proxy: ProfileProxy, localPort: number): Record<string, unknown> {
  const hops = [proxy, ...(proxy.chain ?? [])].slice(0, 3);
  const outbounds: Record<string, unknown>[] = [];

  for (let i = 0; i < hops.length; i += 1) {
    const hop = hops[i]!;
    const tag = i === hops.length - 1 ? 'proxy' : `hop-${i}`;
    const detour = i > 0 ? `hop-${i - 1}` : undefined;
    outbounds.push(buildSingleSingBoxOutbound(hop, tag, detour));
  }
  outbounds.push({ type: 'block', tag: 'block' });

  return {
    log: { level: 'warn' },
    inbounds: [
      {
        type: 'socks',
        tag: 'socks-in',
        listen: '127.0.0.1',
        listen_port: localPort,
      },
    ],
    outbounds,
    route: {
      final: 'proxy',
    },
  };
}

export class ProxyCoreManager {
  private coresDir: string;
  private logger: AppLogger;
  private downloading = new Set<ExternalCoreName>();

  constructor(coresDir: string, logger: AppLogger) {
    this.coresDir = coresDir;
    this.logger = logger;
  }

  getCoreExecutablePath(core: ExternalCoreName): string {
    return path.join(this.coresDir, core, getBinaryFileName(core));
  }

  hasCore(core: ExternalCoreName): boolean {
    return fs.existsSync(this.getCoreExecutablePath(core));
  }

  async listCores(): Promise<ProxyCoreInfo[]> {
    const cores: ExternalCoreName[] = ['sing-box', 'xray'];
    const result: ProxyCoreInfo[] = [];
    for (const core of cores) {
      const exe = this.getCoreExecutablePath(core);
      const installed = fs.existsSync(exe);
      const version = installed ? await execVersion(exe, ['version']) : 'Chưa cài';
      result.push({ name: core, installed, version, executablePath: exe });
    }
    return result;
  }

  async downloadCore(
    core: ExternalCoreName,
    onProgress: (ev: ProxyCoreDownloadProgress) => void,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.downloading.has(core)) {
      return { ok: false, error: `Đang tải ${core}, vui lòng chờ hoàn tất.` };
    }
    this.downloading.add(core);
    try {
      const targetDir = path.join(this.coresDir, core);
      fs.mkdirSync(targetDir, { recursive: true });
      onProgress({ core, percent: 5, line: `Đang kiểm tra phiên bản mới nhất của ${core}...` });

      const apiUrl =
        core === 'sing-box'
          ? 'https://api.github.com/repos/SagerNet/sing-box/releases/latest'
          : 'https://api.github.com/repos/XTLS/Xray-core/releases/latest';

      const release = await httpsGetJson(apiUrl);
      const assets = (release['assets'] as { name: string; browser_download_url: string }[]) ?? [];
      const osToken =
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
            ? 'darwin'
            : 'linux';
      const archToken = process.arch === 'arm64' ? 'arm64' : 'amd64';

      const asset = assets.find((a) => {
        const lower = a.name.toLowerCase();
        if (core === 'sing-box') {
          return lower.includes(`${osToken}-${archToken}`) && (lower.endsWith('.zip') || lower.endsWith('.tar.gz'));
        }
        const xrayArch = process.arch === 'arm64' ? 'arm64-v8a' : '64';
        const xrayOs = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
        return lower.includes(`${xrayOs}-${xrayArch}`) && lower.endsWith('.zip');
      });

      if (!asset) {
        throw new Error(`Không tìm thấy gói tải ${core} phù hợp cho ${osToken}-${archToken}`);
      }

      const archivePath = path.join(targetDir, asset.name);
      onProgress({ core, percent: 10, line: `Đang tải ${asset.name}...` });
      const actualSha256 = await downloadFileWithProgress(
        asset.browser_download_url,
        archivePath,
        (pct) => onProgress({ core, percent: 10 + Math.round(pct * 0.75), line: `Đang tải ${pct}%...` }),
      );

      this.logger.info('proxyCore', `Downloaded ${asset.name} (sha256=${actualSha256.slice(0, 16)}...)`);

      // Extract archive (PowerShell Expand-Archive on Windows, tar/unzip on POSIX)
      onProgress({ core, percent: 90, line: 'Đang giải nén...' });
      await new Promise<void>((resolve, reject) => {
        const cmd = process.platform === 'win32' ? 'powershell' : archivePath.endsWith('.zip') ? 'unzip' : 'tar';
        const args =
          process.platform === 'win32'
            ? [
                '-NoProfile',
                '-Command',
                `Expand-Archive -Path "${archivePath}" -DestinationPath "${targetDir}" -Force`,
              ]
            : archivePath.endsWith('.zip')
              ? ['-o', archivePath, '-d', targetDir]
              : ['-xzf', archivePath, '-C', targetDir];
        const child = spawn(cmd, args);
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`Giải nén thất bại (mã ${code ?? -1})`)),
        );
      });

      // Locate binary inside extracted subfolders and move to targetDir/<bin>
      const expectedBin = getBinaryFileName(core);
      const finalBin = this.getCoreExecutablePath(core);
      if (!fs.existsSync(finalBin)) {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const nested = path.join(targetDir, entry.name, expectedBin);
            if (fs.existsSync(nested)) {
              fs.copyFileSync(nested, finalBin);
              break;
            }
          }
        }
      }
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      if (!fs.existsSync(finalBin)) {
        throw new Error(`Không tìm thấy file thực thi ${expectedBin} sau khi giải nén`);
      }

      onProgress({ core, percent: 100, line: `Đã cài đặt ${core} thành công!`, done: true, success: true });
      return { ok: true };
    } catch (err) {
      const friendly = classifyDownloadError(err);
      this.logger.error('proxyCore', `Download ${core} failed: ${friendly}`);
      onProgress({ core, percent: null, line: friendly, done: true, success: false, error: friendly });
      return { ok: false, error: friendly };
    } finally {
      this.downloading.delete(core);
    }
  }
}
