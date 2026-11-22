import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import * as proxyChain from 'proxy-chain';
import { SocksClient, type SocksProxy } from 'socks';
import { Client as SshClient } from 'ssh2';
import type { BrowserType, ProfileProxy, ProxyType } from '@shared/types';
import { formatHostForUrl } from './proxyParser';
import { buildSingBoxConfig, type ProxyCoreManager } from './proxyCoreManager';
import type { AppLogger } from './logger';

export interface BridgeHandle {
  host: '127.0.0.1';
  port: number;
  type: 'http' | 'socks5';
  stop: () => Promise<void>;
}

export interface BrowserProxyDecision {
  viaBridge: boolean;
  protocolUsed: ProxyType;
  dnsLeakRisk: boolean;
  directServerUrl: string | null;
  directUsername?: string;
  directPassword?: string;
}

const EXTERNAL_CORE_PROTOCOLS = new Set<ProxyType>(['shadowsocks', 'vmess', 'vless', 'trojan']);

export function isExternalCoreProtocol(type: ProxyType): boolean {
  return EXTERNAL_CORE_PROTOCOLS.has(type);
}

export function hasDnsLeakRisk(proxy: ProfileProxy): boolean {
  if (proxy.type === 'none') return false;
  if (proxy.chain && proxy.chain.length > 0) {
    return proxy.chain.every(
      (hop) =>
        hop.type === 'http' ||
        hop.type === 'https' ||
        hop.type === 'socks4' ||
        hop.type === 'socks5',
    );
  }
  return (
    proxy.type === 'http' ||
    proxy.type === 'https' ||
    proxy.type === 'socks4' ||
    proxy.type === 'socks5'
  );
}

/**
 * Decides whether a proxy can be passed directly to the browser or MUST route through local bridge.
 */
export function buildBrowserProxyArgs(
  proxy: ProfileProxy,
  browserKind: BrowserType,
): BrowserProxyDecision {
  if (proxy.type === 'none' || !proxy.host || proxy.port <= 0) {
    return {
      viaBridge: false,
      protocolUsed: 'none',
      dnsLeakRisk: false,
      directServerUrl: null,
    };
  }

  const hasChain = Boolean(proxy.chain && proxy.chain.length > 0);
  const hasAuth = Boolean(proxy.username || proxy.password);
  const dnsLeakRisk = hasDnsLeakRisk(proxy);

  // Chain, SSH, external cores (ss/vmess/vless/trojan), and DNS-remote socks4a/socks5h ALWAYS require bridge
  if (
    hasChain ||
    proxy.type === 'ssh' ||
    proxy.type === 'socks4a' ||
    proxy.type === 'socks5h' ||
    isExternalCoreProtocol(proxy.type)
  ) {
    return {
      viaBridge: true,
      protocolUsed: proxy.type,
      dnsLeakRisk,
      directServerUrl: null,
    };
  }

  // SOCKS5 with auth: Chrome/Chromium requires bridge; Firefox supports direct auth
  if (proxy.type === 'socks5' && hasAuth) {
    if (browserKind === 'firefox') {
      return {
        viaBridge: false,
        protocolUsed: 'socks5',
        dnsLeakRisk,
        directServerUrl: `socks5://${formatHostForUrl(proxy.host)}:${proxy.port}`,
        directUsername: proxy.username,
        directPassword: proxy.password,
      };
    }
    return {
      viaBridge: true,
      protocolUsed: 'socks5',
      dnsLeakRisk,
      directServerUrl: null,
    };
  }

  // Direct: HTTP/HTTPS (with or without auth), SOCKS4, unauthenticated SOCKS5
  return {
    viaBridge: false,
    protocolUsed: proxy.type,
    dnsLeakRisk,
    directServerUrl: `${proxy.type}://${formatHostForUrl(proxy.host)}:${proxy.port}`,
    ...(hasAuth ? { directUsername: proxy.username, directPassword: proxy.password } : {}),
  };
}

function hashProxyForBridge(proxy: ProfileProxy): string {
  return crypto.createHash('sha256').update(JSON.stringify(proxy)).digest('hex');
}

function getFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === 'object' && addr.address === '127.0.0.1') {
          resolve(addr.port);
        } else {
          reject(new Error('Không thể cấp phát cổng nội bộ 127.0.0.1'));
        }
      });
    });
    srv.on('error', reject);
  });
}

function assertLocalhostOnly(server: net.Server): number {
  const addr = server.address();
  if (!addr || typeof addr !== 'object' || addr.address !== '127.0.0.1') {
    server.close();
    throw new Error('Vi phạm bảo mật: bridge chỉ được phép lắng nghe trên 127.0.0.1');
  }
  return addr.port;
}

/**
 * Minimal local SOCKS5 server (no-auth, bound strictly to 127.0.0.1) delegating target connections
 * to a custom dialer (used by SOCKS4/4a/5/5h, chain, and SSH bridges).
 */
function createLocalSocks5Server(
  dial: (targetHost: string, targetPort: number) => Promise<net.Socket | NodeJS.ReadWriteStream>,
): Promise<{ server: net.Server; port: number; destroyAllSockets: () => void }> {
  const activeSockets = new Set<net.Socket>();
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      activeSockets.add(client);
      client.on('close', () => {
        activeSockets.delete(client);
      });
      // Reject any non-loopback peer defensively
      const remote = client.remoteAddress ?? '';
      if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        client.destroy();
        return;
      }

      let stage: 'greeting' | 'request' | 'streaming' = 'greeting';
      let buf = Buffer.alloc(0);

      client.on('error', () => {
        client.destroy();
      });

      client.on('data', (chunk: Buffer) => {
        if (stage === 'streaming') return;
        buf = Buffer.concat([buf, chunk]);

        if (stage === 'greeting') {
          if (buf.length < 2) return;
          const nMethods = buf[1] ?? 0;
          if (buf.length < 2 + nMethods) return;
          buf = buf.subarray(2 + nMethods);
          stage = 'request';
          client.write(Buffer.from([0x05, 0x00])); // SOCKS5, no-auth
        }

        if (stage === 'request') {
          if (buf.length < 4) return;
          const cmd = buf[1];
          const atyp = buf[3];
          if (cmd !== 0x01) {
            client.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return;
          }

          let host = '';
          let portOffset = 0;

          if (atyp === 0x01) {
            if (buf.length < 10) return;
            host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
            portOffset = 8;
          } else if (atyp === 0x03) {
            const len = buf[4] ?? 0;
            if (buf.length < 5 + len + 2) return;
            host = buf.subarray(5, 5 + len).toString('utf8');
            portOffset = 5 + len;
          } else if (atyp === 0x04) {
            if (buf.length < 22) return;
            const groups: string[] = [];
            for (let i = 0; i < 16; i += 2) {
              groups.push(buf.readUInt16BE(4 + i).toString(16));
            }
            host = groups.join(':');
            portOffset = 20;
          } else {
            client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return;
          }

          const port = buf.readUInt16BE(portOffset);
          const trailing = buf.subarray(portOffset + 2);
          buf = Buffer.alloc(0);
          stage = 'streaming';
          client.pause();

          void dial(host, port)
            .then((upstream) => {
              client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              if (trailing.length > 0) {
                upstream.write(trailing);
              }
              client.pipe(upstream);
              upstream.pipe(client);
              client.resume();
              upstream.on('error', () => client.destroy());
              client.on('close', () => {
                if ('destroy' in upstream && typeof upstream.destroy === 'function') {
                  upstream.destroy();
                }
              });
            })
            .catch(() => {
              if (!client.destroyed) {
                client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              }
            });
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      try {
        const port = assertLocalhostOnly(server);
        resolve({
          server,
          port,
          destroyAllSockets: () => {
            for (const sock of activeSockets) {
              sock.destroy();
            }
            activeSockets.clear();
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

function toSocksProxyObj(proxy: ProfileProxy): SocksProxy {
  const isV4 = proxy.type === 'socks4' || proxy.type === 'socks4a';
  return {
    host: proxy.host.trim().replace(/^\[|\]$/g, ''),
    port: proxy.port,
    type: isV4 ? 4 : 5,
    ...(proxy.username ? { userId: proxy.username } : {}),
    ...(proxy.password ? { password: proxy.password } : {}),
  };
}

interface ActiveBridgeEntry {
  profileId: string;
  configHash: string;
  handle: BridgeHandle;
}

export class ProxyBridgeManager {
  private bridges = new Map<string, ActiveBridgeEntry>();
  private logger: AppLogger;
  private coreManager: ProxyCoreManager | null;
  private pidFilePath: string | null;
  private onFatalError?: (profileId: string, error: string) => void;

  constructor(
    logger: AppLogger,
    coreManager: ProxyCoreManager | null = null,
    pidFilePath: string | null = null,
    onFatalError?: (profileId: string, error: string) => void,
  ) {
    this.logger = logger;
    this.coreManager = coreManager;
    this.pidFilePath = pidFilePath;
    this.onFatalError = onFatalError;
  }

  private trackChildPid(pid: number): void {
    if (!this.pidFilePath) return;
    try {
      const existing = this.readTrackedPids();
      if (!existing.includes(pid)) {
        existing.push(pid);
        fs.mkdirSync(path.dirname(this.pidFilePath), { recursive: true });
        fs.writeFileSync(this.pidFilePath, JSON.stringify(existing), 'utf8');
      }
    } catch {
      // Ignore PID persistence errors
    }
  }

  private untrackChildPid(pid: number): void {
    if (!this.pidFilePath) return;
    try {
      const next = this.readTrackedPids().filter((p) => p !== pid);
      fs.writeFileSync(this.pidFilePath, JSON.stringify(next), 'utf8');
    } catch {
      // Ignore
    }
  }

  private readTrackedPids(): number[] {
    if (!this.pidFilePath || !fs.existsSync(this.pidFilePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.pidFilePath, 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === 'number') : [];
    } catch {
      return [];
    }
  }

  cleanupOrphanProcesses(): void {
    const pids = this.readTrackedPids();
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
        this.logger.info('proxyBridge', `Cleaned up orphan bridge process pid=${pid}`);
      } catch {
        // Process already exited
      }
    }
    if (this.pidFilePath && fs.existsSync(this.pidFilePath)) {
      try {
        fs.writeFileSync(this.pidFilePath, '[]', 'utf8');
      } catch {
        // Ignore
      }
    }
  }

  async startBridge(proxy: ProfileProxy, profileId: string): Promise<BridgeHandle> {
    const configHash = hashProxyForBridge(proxy);
    const existing = this.bridges.get(profileId);
    if (existing && existing.configHash === configHash) {
      return existing.handle;
    }
    if (existing) {
      await this.stopBridge(profileId);
    }

    const hops = [proxy, ...(proxy.chain ?? [])].slice(0, 3);
    const usesExternalCore = hops.some((h) => isExternalCoreProtocol(h.type));

    let handle: BridgeHandle;
    if (usesExternalCore) {
      handle = await this.startSingBoxBridge(proxy, profileId);
    } else if (proxy.type === 'ssh') {
      handle = await this.startSshBridge(proxy, profileId);
    } else if (
      proxy.type === 'socks4' ||
      proxy.type === 'socks4a' ||
      proxy.type === 'socks5' ||
      proxy.type === 'socks5h'
    ) {
      handle = await this.startSocksBridge(hops, profileId);
    } else {
      handle = await this.startHttpProxyChainBridge(proxy, profileId);
    }

    this.bridges.set(profileId, { profileId, configHash, handle });
    this.logger.info(
      'proxyBridge',
      `Bridge started for profile=${profileId} protocol=${proxy.type} on 127.0.0.1:${handle.port} (${handle.type})`,
    );
    return handle;
  }

  async stopBridge(profileId: string): Promise<void> {
    const entry = this.bridges.get(profileId);
    if (!entry) return;
    this.bridges.delete(profileId);
    await entry.handle.stop().catch(() => {});
    this.logger.info('proxyBridge', `Bridge stopped for profile=${profileId}`);
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.bridges.keys());
    for (const id of ids) {
      await this.stopBridge(id);
    }
  }

  private async startHttpProxyChainBridge(
    proxy: ProfileProxy,
    profileId: string,
  ): Promise<BridgeHandle> {
    const auth =
      proxy.username || proxy.password
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
        : '';
    const upstreamUrl = `${proxy.type}://${auth}${formatHostForUrl(proxy.host)}:${proxy.port}`;
    const localUrl = await proxyChain.anonymizeProxy(upstreamUrl);
    const parsed = new URL(localUrl);
    const port = Number(parsed.port);

    return {
      host: '127.0.0.1',
      port,
      type: 'http',
      stop: async () => {
        await proxyChain.closeAnonymizedProxy(localUrl, true).catch(() => {});
        this.bridges.delete(profileId);
      },
    };
  }

  private async startSocksBridge(hops: ProfileProxy[], profileId: string): Promise<BridgeHandle> {
    const socksProxies = hops.map(toSocksProxyObj);
    const { server, port, destroyAllSockets } = await createLocalSocks5Server(
      async (targetHost, targetPort) => {
        if (socksProxies.length === 1) {
          const info = await SocksClient.createConnection({
            proxy: socksProxies[0]!,
            command: 'connect',
            destination: { host: targetHost, port: targetPort },
            timeout: 15_000,
          });
          return info.socket;
        }
        const info = await SocksClient.createConnectionChain({
          command: 'connect',
          proxies: socksProxies,
          destination: { host: targetHost, port: targetPort },
          timeout: 15_000,
        });
        return info.socket;
      },
    );

    return {
      host: '127.0.0.1',
      port,
      type: 'socks5',
      stop: () =>
        new Promise<void>((resolve) => {
          this.bridges.delete(profileId);
          destroyAllSockets();
          server.close(() => resolve());
        }),
    };
  }

  private async startSshBridge(proxy: ProfileProxy, profileId: string): Promise<BridgeHandle> {
    let sshClient: SshClient | null = null;
    let stopped = false;
    let serverRef: net.Server | null = null;

    const connectSsh = (): Promise<SshClient> =>
      new Promise((resolve, reject) => {
        const client = new SshClient();
        client
          .on('ready', () => resolve(client))
          .on('error', (err) => reject(err))
          .connect({
            host: proxy.host.trim().replace(/^\[|\]$/g, ''),
            port: proxy.port || 22,
            username: proxy.username || 'root',
            ...(proxy.privateKey ? { privateKey: proxy.privateKey } : { password: proxy.password }),
            readyTimeout: 15_000,
          });
      });

    const attachReconnect = (client: SshClient): void => {
      client.on('close', () => {
        if (stopped) return;
        void (async () => {
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            if (stopped) return;
            await new Promise((r) => setTimeout(r, attempt * 1000));
            try {
              const next = await connectSsh();
              sshClient = next;
              attachReconnect(next);
              this.logger.info('proxyBridge', `SSH bridge reconnected (attempt ${attempt})`);
              return;
            } catch {
              // Retry up to 3 times
            }
          }
          // Kill switch: close local listener so browser cannot bypass to direct IP
          stopped = true;
          serverRef?.close();
          this.bridges.delete(profileId);
          const msg = 'SSH tunnel bị ngắt kết nối sau 3 lần thử lại. Đã kích hoạt kill switch.';
          this.logger.error('proxyBridge', msg);
          this.onFatalError?.(profileId, msg);
        })();
      });
    };

    sshClient = await connectSsh();
    attachReconnect(sshClient);

    const { server, port, destroyAllSockets } = await createLocalSocks5Server(
      (targetHost, targetPort) => {
        return new Promise((resolve, reject) => {
          if (!sshClient || stopped) {
            reject(new Error('SSH tunnel đã đóng'));
            return;
          }
          sshClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
            if (err) reject(err);
            else resolve(stream);
          });
        });
      },
    );
    serverRef = server;

    return {
      host: '127.0.0.1',
      port,
      type: 'socks5',
      stop: () =>
        new Promise<void>((resolve) => {
          stopped = true;
          this.bridges.delete(profileId);
          sshClient?.end();
          destroyAllSockets();
          server.close(() => resolve());
        }),
    };
  }

  private async startSingBoxBridge(proxy: ProfileProxy, profileId: string): Promise<BridgeHandle> {
    if (!this.coreManager || !this.coreManager.hasCore('sing-box')) {
      throw new Error(
        'Chưa cài lõi sing-box cho giao thức Shadowsocks/VMess/VLESS/Trojan. Vào Cài đặt → Lõi proxy để tải về.',
      );
    }

    const exe = this.coreManager.getCoreExecutablePath('sing-box');
    const port = await getFreeLocalPort();
    const configPath = path.join(os.tmpdir(), `antidetect-sb-${profileId}-${Date.now()}.json`);
    const configJson = JSON.stringify(buildSingBoxConfig(proxy, port));
    fs.writeFileSync(configPath, configJson, { encoding: 'utf8', mode: 0o600 });

    let child: ChildProcess | null = null;
    let stopped = false;

    const cleanupConfig = (): void => {
      if (fs.existsSync(configPath)) {
        try {
          fs.unlinkSync(configPath);
        } catch {
          // Ignore
        }
      }
    };

    child = spawn(exe, ['run', '-c', configPath], { stdio: 'ignore' });
    if (child.pid) {
      this.trackChildPid(child.pid);
    }

    child.on('exit', (code) => {
      if (child?.pid) this.untrackChildPid(child.pid);
      if (!stopped) {
        cleanupConfig();
        this.bridges.delete(profileId);
        const msg = `Tiến trình sing-box dừng đột ngột (mã ${code ?? -1}). Đã kích hoạt kill switch.`;
        this.logger.error('proxyBridge', msg);
        this.onFatalError?.(profileId, msg);
      }
    });

    // Wait briefly for sing-box inbound port to start listening
    await new Promise((r) => setTimeout(r, 400));

    return {
      host: '127.0.0.1',
      port,
      type: 'socks5',
      stop: async () => {
        stopped = true;
        this.bridges.delete(profileId);
        if (child && !child.killed) {
          child.kill('SIGTERM');
        }
        if (child?.pid) this.untrackChildPid(child.pid);
        cleanupConfig();
      },
    };
  }
}
