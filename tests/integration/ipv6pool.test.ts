import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Ipv6EgressListener,
  type EgressConnectParams,
} from '../../electron/services/ipv6pool/egress';

const DOC_EGRESS_IPV6 = '2001:db8:abcd:1::7777';

function sendRawConnect(
  proxyPort: number,
  targetAuthority: string,
  authHeader?: string,
): Promise<{ statusLine: string; socket: net.Socket; initialData: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port: proxyPort });
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        sock.removeListener('data', onData);
        const statusLine = buf.slice(0, buf.indexOf('\r\n'));
        const rest = buf.slice(headerEnd + 4);
        resolve({ statusLine, socket: sock, initialData: rest });
      }
    };
    sock.on('data', onData);
    sock.on('error', reject);
    sock.once('connect', () => {
      const headers = [`CONNECT ${targetAuthority} HTTP/1.1`, `Host: ${targetAuthority}`];
      if (authHeader) headers.push(`Proxy-Authorization: ${authHeader}`);
      sock.write(`${headers.join('\r\n')}\r\n\r\n`);
    });
  });
}

describe('Local IPv6 Pool Egress Listener Integration Tests (Mocked local target, zero external calls)', () => {
  let targetServer: net.Server;
  let targetPort = 0;

  beforeAll(async () => {
    // Simple local TCP echo server on 127.0.0.1 acting as mocked remote IPv6 destination
    targetServer = net.createServer((socket) => {
      socket.on('data', (d) => {
        socket.write(d);
      });
    });
    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', () => {
        targetPort = (targetServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  });

  it('binds strictly to 127.0.0.1, requires Basic auth, passes exact localAddress + family:6, blocks IPv4-only targets, enforces concurrency limit & kill switch', async () => {
    const connectCalls: EgressConnectParams[] = [];
    let addressAlive = true;
    let fatalCode = '';

    const listener = new Ipv6EgressListener({
      egressIpv6: DOC_EGRESS_IPV6,
      maxConcurrentConnections: 2,
      resolve6: async (hostname) => {
        if (hostname === 'ipv6-target.test') return ['2001:db8:9999::1'];
        if (hostname === 'ipv4-only.test') return [];
        return [];
      },
      connect: (params) => {
        connectCalls.push(params);
        // Redirect mocked IPv6 egress to our local TCP echo server so we don't need real IPv6 routing in CI
        return net.connect({ host: '127.0.0.1', port: targetPort });
      },
      isAddressAlive: () => addressAlive,
      onFatalError: (_addr, code) => {
        fatalCode = code;
      },
    });

    const info = await listener.start();
    expect(info.host).toBe('127.0.0.1');
    expect(info.port).toBeGreaterThan(0);

    const validAuth = `Basic ${Buffer.from(`${info.username}:${info.password}`).toString('base64')}`;
    const wrongAuth = `Basic ${Buffer.from(`${info.username}:wrongpass`).toString('base64')}`;

    // 1. Missing auth -> 407
    const noAuthRes = await sendRawConnect(info.port, `ipv6-target.test:${targetPort}`);
    expect(noAuthRes.statusLine).toContain('407');
    noAuthRes.socket.destroy();

    // 2. Wrong auth -> 407
    const badAuthRes = await sendRawConnect(info.port, `ipv6-target.test:${targetPort}`, wrongAuth);
    expect(badAuthRes.statusLine).toContain('407');
    badAuthRes.socket.destroy();

    // 3. IPv4-only target (literal IPv4 AND hostname with no AAAA) -> 502, NEVER calls connect()
    const ipv4LitRes = await sendRawConnect(info.port, `192.0.2.1:${targetPort}`, validAuth);
    expect(ipv4LitRes.statusLine).toContain('502');
    ipv4LitRes.socket.destroy();

    const ipv4HostRes = await sendRawConnect(info.port, `ipv4-only.test:${targetPort}`, validAuth);
    expect(ipv4HostRes.statusLine).toContain('502');
    ipv4HostRes.socket.destroy();
    expect(connectCalls).toHaveLength(0);

    // 4. Valid IPv6 target -> 200, passes exact localAddress + family: 6, tracks activeConnections, enforces max=2
    const t1 = await sendRawConnect(info.port, `ipv6-target.test:${targetPort}`, validAuth);
    expect(t1.statusLine).toContain('200');
    expect(connectCalls[0]).toEqual({
      host: '2001:db8:9999::1',
      port: targetPort,
      localAddress: DOC_EGRESS_IPV6,
      family: 6,
    });
    expect(listener.getActiveConnections()).toBe(1);

    const t2 = await sendRawConnect(info.port, `ipv6-target.test:${targetPort}`, validAuth);
    expect(t2.statusLine).toContain('200');
    expect(listener.getActiveConnections()).toBe(2);

    // 3rd simultaneous connection exceeds maxConcurrentConnections=2 -> 429
    const t3 = await sendRawConnect(info.port, `ipv6-target.test:${targetPort}`, validAuth);
    expect(t3.statusLine).toContain('429');
    t3.socket.destroy();

    // Close tunnels -> activeConnections drops back to 0
    t1.socket.destroy();
    t2.socket.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(listener.getActiveConnections()).toBe(0);

    // 5. Mid-session Kill Switch: address removed -> next request fails with 502 and triggers onFatalError
    addressAlive = false;
    const killRes = await sendRawConnect(info.port, `ipv6-target.test:${targetPort}`, validAuth);
    expect(killRes.statusLine).toContain('502');
    killRes.socket.destroy();
    expect(fatalCode).toBe('EADDRNOTAVAIL');
    expect(listener.isRunning()).toBe(false);

    // Also verify HTTP forward proxy blocks unauthenticated requests cleanly
    const listener2 = new Ipv6EgressListener({
      egressIpv6: DOC_EGRESS_IPV6,
      resolve6: async () => [],
    });
    const info2 = await listener2.start();
    const httpStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: info2.port,
          path: 'http://ipv4-only.test/',
          method: 'GET',
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(httpStatus).toBe(407);
    await listener2.stop();
  });
});
