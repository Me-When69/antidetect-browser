import crypto from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { normalizeIpv6 } from './prefix';

export const DEFAULT_MAX_CONCURRENT_PER_LISTENER = 200;

export interface EgressConnectParams {
  host: string;
  port: number;
  localAddress: string;
  family: 6;
}

export interface EgressListenerOptions {
  egressIpv6: string;
  username?: string;
  password?: string;
  maxConcurrentConnections?: number;
  /** Injectable for tests; defaults to dns.promises.resolve6. */
  resolve6?: (hostname: string) => Promise<string[]>;
  /** Injectable for tests; defaults to net.connect with localAddress + family: 6. */
  connect?: (params: EgressConnectParams) => net.Socket;
  /** Optional health predicate (e.g., check if address is still assigned). */
  isAddressAlive?: () => boolean;
  onFatalError?: (egressIpv6: string, errorCode: string) => void;
  onConnectionCountChange?: (egressIpv6: string, activeConnections: number) => void;
}

export interface EgressListenerInfo {
  egressIpv6: string;
  host: '127.0.0.1';
  port: number;
  username: string;
  password: string;
  activeConnections: number;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyProxyAuth(headerVal: string | undefined, expectedUser: string, expectedPass: string): boolean {
  if (!headerVal) return false;
  const match = headerVal.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return timingSafeStringEqual(user, expectedUser) && timingSafeStringEqual(pass, expectedPass);
}

function parseAuthority(rawAuthority: string): { hostname: string; port: number } | null {
  const trimmed = rawAuthority.trim();
  if (!trimmed) return null;
  // IPv6 literal [::1]:443
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    if (closeIdx === -1) return null;
    const hostname = trimmed.slice(1, closeIdx);
    const rest = trimmed.slice(closeIdx + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { hostname, port };
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon === -1) {
    return { hostname: trimmed, port: 443 };
  }
  const hostname = trimmed.slice(0, lastColon);
  const port = Number(trimmed.slice(lastColon + 1));
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname, port };
}

/**
 * Local authenticated HTTP CONNECT / HTTP proxy bound strictly to 127.0.0.1.
 * Enforces IPv6-only egress (AAAA DNS resolution + localAddress + family: 6)
 * and fails closed (kill switch) if target is IPv4-only or address is removed.
 */
export class Ipv6EgressListener {
  readonly egressIpv6: string;
  readonly username: string;
  readonly password: string;
  private maxConcurrent: number;
  private resolve6Fn: (hostname: string) => Promise<string[]>;
  private connectFn: (params: EgressConnectParams) => net.Socket;
  private isAddressAliveFn?: () => boolean;
  private onFatalError?: (egressIpv6: string, errorCode: string) => void;
  private onConnectionCountChange?: (egressIpv6: string, activeConnections: number) => void;

  private server: http.Server | null = null;
  private port = 0;
  private activeConnections = 0;
  private openSockets = new Set<net.Socket>();
  private closed = false;

  constructor(options: EgressListenerOptions) {
    this.egressIpv6 = normalizeIpv6(options.egressIpv6);
    this.username = options.username ?? `f6_${crypto.randomBytes(8).toString('hex')}`;
    this.password = options.password ?? crypto.randomBytes(18).toString('base64url');
    this.maxConcurrent = Math.max(
      1,
      Math.min(2000, options.maxConcurrentConnections ?? DEFAULT_MAX_CONCURRENT_PER_LISTENER),
    );
    this.resolve6Fn = options.resolve6 ?? ((host) => dns.promises.resolve6(host));
    this.connectFn =
      options.connect ??
      ((params) =>
        net.connect({
          host: params.host,
          port: params.port,
          localAddress: params.localAddress,
          family: 6,
        }));
    this.isAddressAliveFn = options.isAddressAlive;
    this.onFatalError = options.onFatalError;
    this.onConnectionCountChange = options.onConnectionCountChange;
  }

  getInfo(): EgressListenerInfo {
    return {
      egressIpv6: this.egressIpv6,
      host: '127.0.0.1',
      port: this.port,
      username: this.username,
      password: this.password,
      activeConnections: this.activeConnections,
    };
  }

  getActiveConnections(): number {
    return this.activeConnections;
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.server !== null && !this.closed;
  }

  private setActiveConnections(next: number): void {
    const clamped = Math.max(0, next);
    if (clamped !== this.activeConnections) {
      this.activeConnections = clamped;
      this.onConnectionCountChange?.(this.egressIpv6, this.activeConnections);
    }
  }

  private async resolveTargetIpv6(hostname: string): Promise<string> {
    if (net.isIPv4(hostname)) {
      const err = new Error('IPv4-only destination blocked by IPv6 kill switch') as NodeJS.ErrnoException;
      err.code = 'EIPV4ONLY';
      throw err;
    }
    if (net.isIPv6(hostname)) {
      return normalizeIpv6(hostname);
    }
    const records = await this.resolve6Fn(hostname);
    const valid = records.find((r) => net.isIPv6(r));
    if (!valid) {
      const err = new Error('No AAAA record available (IPv4-only target blocked)') as NodeJS.ErrnoException;
      err.code = 'ENODATA';
      throw err;
    }
    return normalizeIpv6(valid);
  }

  private checkAddressAliveOrFail(): boolean {
    if (this.closed) return false;
    if (this.isAddressAliveFn && !this.isAddressAliveFn()) {
      this.triggerKillSwitch('EADDRNOTAVAIL');
      return false;
    }
    return true;
  }

  /**
   * Immediately kill all active tunnels and close the listener (kill switch).
   */
  triggerKillSwitch(errorCode = 'EADDRNOTAVAIL'): void {
    if (this.closed) return;
    void this.stop();
    this.onFatalError?.(this.egressIpv6, errorCode);
  }

  async start(): Promise<EgressListenerInfo> {
    if (this.server) return this.getInfo();
    this.closed = false;

    const server = http.createServer((req, res) => {
      void this.handleHttpForward(req, res);
    });

    server.on('connect', (req, clientSocket, head) => {
      void this.handleConnect(req, clientSocket as net.Socket, head);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      this.triggerKillSwitch(err.code ?? 'ESERVER');
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // STRICT: Always bind ONLY to 127.0.0.1, never 0.0.0.0 or external interfaces!
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address() as AddressInfo | null;
        this.port = addr?.port ?? 0;
        resolve();
      });
    });

    this.server = server;
    return this.getInfo();
  }

  async stop(): Promise<void> {
    this.closed = true;
    for (const sock of this.openSockets) {
      try {
        sock.destroy();
      } catch {
        // Ignore
      }
    }
    this.openSockets.clear();
    this.setActiveConnections(0);

    const srv = this.server;
    this.server = null;
    this.port = 0;
    if (!srv) return;

    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }

  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    if (!this.checkAddressAliveOrFail()) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    if (!verifyProxyAuth(req.headers['proxy-authorization'], this.username, this.password)) {
      clientSocket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Facet-IPv6"\r\n\r\n',
      );
      return;
    }

    if (this.activeConnections >= this.maxConcurrent) {
      clientSocket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return;
    }

    const authority = parseAuthority(req.url ?? '');
    if (!authority) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    let resolvedIpv6: string;
    try {
      resolvedIpv6 = await this.resolveTargetIpv6(authority.hostname);
    } catch {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nIPv6-only: no AAAA record');
      return;
    }

    if (!this.checkAddressAliveOrFail()) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    let released = false;
    this.setActiveConnections(this.activeConnections + 1);
    this.openSockets.add(clientSocket);

    const upstream = this.connectFn({
      host: resolvedIpv6,
      port: authority.port,
      localAddress: this.egressIpv6,
      family: 6,
    });
    this.openSockets.add(upstream);

    const cleanup = () => {
      if (released) return;
      released = true;
      this.openSockets.delete(clientSocket);
      this.openSockets.delete(upstream);
      this.setActiveConnections(this.activeConnections - 1);
      if (!clientSocket.destroyed) clientSocket.destroy();
      if (!upstream.destroyed) upstream.destroy();
    };

    upstream.once('connect', () => {
      if (this.closed) {
        cleanup();
        return;
      }
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on('error', (err: NodeJS.ErrnoException) => {
      if (!clientSocket.writableEnded) {
        try {
          clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } catch {
          // Ignore
        }
      }
      cleanup();
      if (err.code === 'EADDRNOTAVAIL') {
        this.triggerKillSwitch('EADDRNOTAVAIL');
      }
    });

    clientSocket.on('error', cleanup);
    clientSocket.on('close', cleanup);
    upstream.on('close', cleanup);
  }

  private async handleHttpForward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.checkAddressAliveOrFail()) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('IPv6 egress unavailable');
      return;
    }

    if (!verifyProxyAuth(req.headers['proxy-authorization'], this.username, this.password)) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Facet-IPv6"' });
      res.end('Proxy Authentication Required');
      return;
    }

    if (this.activeConnections >= this.maxConcurrent) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too Many Concurrent Connections');
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(req.url ?? '');
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    let resolvedIpv6: string;
    try {
      resolvedIpv6 = await this.resolveTargetIpv6(targetUrl.hostname.replace(/^\[|\]$/g, ''));
    } catch {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('IPv6-only: target has no AAAA record');
      return;
    }

    let released = false;
    this.setActiveConnections(this.activeConnections + 1);
    const release = () => {
      if (released) return;
      released = true;
      this.setActiveConnections(this.activeConnections - 1);
    };

    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];

    const upstreamReq = http.request(
      {
        hostname: resolvedIpv6,
        port: targetUrl.port ? Number(targetUrl.port) : 80,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: req.method,
        headers,
        createConnection: () =>
          this.connectFn({
            host: resolvedIpv6,
            port: targetUrl.port ? Number(targetUrl.port) : 80,
            localAddress: this.egressIpv6,
            family: 6,
          }),
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        upstreamRes.on('end', release);
        upstreamRes.on('error', release);
      },
    );

    upstreamReq.on('error', (err: NodeJS.ErrnoException) => {
      release();
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Upstream connection failed');
      }
      if (err.code === 'EADDRNOTAVAIL') {
        this.triggerKillSwitch('EADDRNOTAVAIL');
      }
    });

    res.on('close', release);
    req.pipe(upstreamReq);
  }
}

export interface EgressManagerOptions {
  maxConcurrentPerListener?: number;
  statsBatchIntervalMs?: number;
  resolve6?: (hostname: string) => Promise<string[]>;
  connect?: (params: EgressConnectParams) => net.Socket;
  isAddressAlive?: (egressIpv6: string) => boolean;
  onListenerDead?: (egressIpv6: string, errorCode: string) => void;
  onStatsBatch?: (counts: Record<string, number>) => void;
}

/**
 * Manages multiple local authenticated IPv6 egress listeners with 200ms batched
 * connection-count reporting.
 */
export class Ipv6EgressManager {
  private listeners = new Map<string, Ipv6EgressListener>();
  private options: EgressManagerOptions;
  private dirtyCounts = new Map<string, number>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: EgressManagerOptions = {}) {
    this.options = options;
  }

  private scheduleStatsFlush(egressIpv6: string, count: number): void {
    this.dirtyCounts.set(egressIpv6, count);
    if (this.batchTimer) return;
    const delay = this.options.statsBatchIntervalMs ?? 200;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      if (this.dirtyCounts.size === 0) return;
      const payload: Record<string, number> = {};
      for (const [addr, cnt] of this.dirtyCounts.entries()) {
        payload[addr] = cnt;
      }
      this.dirtyCounts.clear();
      this.options.onStatsBatch?.(payload);
    }, delay);
    if (typeof this.batchTimer.unref === 'function') {
      this.batchTimer.unref();
    }
  }

  async ensureListener(egressIpv6: string): Promise<EgressListenerInfo> {
    const norm = normalizeIpv6(egressIpv6);
    const existing = this.listeners.get(norm);
    if (existing && existing.isRunning()) {
      return existing.getInfo();
    }

    const listener = new Ipv6EgressListener({
      egressIpv6: norm,
      maxConcurrentConnections: this.options.maxConcurrentPerListener,
      resolve6: this.options.resolve6,
      connect: this.options.connect,
      isAddressAlive: this.options.isAddressAlive
        ? () => this.options.isAddressAlive!(norm)
        : undefined,
      onFatalError: (addr, code) => {
        this.listeners.delete(addr);
        this.options.onListenerDead?.(addr, code);
      },
      onConnectionCountChange: (addr, count) => {
        this.scheduleStatsFlush(addr, count);
      },
    });

    const info = await listener.start();
    this.listeners.set(norm, listener);
    return info;
  }

  getListener(egressIpv6: string): Ipv6EgressListener | undefined {
    try {
      return this.listeners.get(normalizeIpv6(egressIpv6));
    } catch {
      return undefined;
    }
  }

  async stopListener(egressIpv6: string): Promise<void> {
    const norm = normalizeIpv6(egressIpv6);
    const listener = this.listeners.get(norm);
    if (!listener) return;
    this.listeners.delete(norm);
    await listener.stop();
  }

  async stopAll(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.dirtyCounts.clear();
    const all = Array.from(this.listeners.values());
    this.listeners.clear();
    await Promise.all(all.map((l) => l.stop()));
  }
}
