import { describe, expect, it } from 'vitest';
import { parseProxy } from '../../electron/services/proxyParser';

describe('Unit: parseProxy', () => {
  it('phân tích đúng các định dạng hợp lệ cơ bản (host:port, host:port:user:pass, URL HTTP/SOCKS5, domain)', () => {
    const r1 = parseProxy('192.168.1.10:8080');
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.hostIpVersion).toBe(4);
      expect(r1.proxy).toEqual({
        type: 'http',
        host: '192.168.1.10',
        port: 8080,
        username: '',
        password: '',
      });
    }

    const r2 = parseProxy('192.168.1.10:8080:alice:pass123');
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.proxy.username).toBe('alice');
      expect(r2.proxy.password).toBe('pass123');
    }

    const r3 = parseProxy('http://bob:secret@10.0.0.5:3128');
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.proxy.type).toBe('http');
      expect(r3.proxy.host).toBe('10.0.0.5');
      expect(r3.proxy.port).toBe(3128);
    }

    const r4 = parseProxy('socks5://carol:pwd@proxy.example.com:1080');
    expect(r4.ok).toBe(true);
    if (r4.ok) {
      expect(r4.hostIpVersion).toBe(0);
      expect(r4.proxy.type).toBe('socks5');
      expect(r4.proxy.host).toBe('proxy.example.com');
    }
  });

  it('phân tích đúng dạng user:pass@host:port không có scheme', () => {
    const r = parseProxy('alice:pass123@198.51.100.5:8080');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proxy).toEqual({
        type: 'http',
        host: '198.51.100.5',
        port: 8080,
        username: 'alice',
        password: 'pass123',
      });
    }
  });

  it('phân tích đúng IPv6 trong ngoặc vuông dạng [addr]:port và URL có IPv6', () => {
    const r1 = parseProxy('[2001:db8::1]:8080');
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.hostIpVersion).toBe(6);
      expect(r1.proxy.host).toBe('2001:db8::1');
      expect(r1.proxy.port).toBe(8080);
    }

    const r2 = parseProxy('socks5://u1:p1@[2001:db8::1]:1080');
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.hostIpVersion).toBe(6);
      expect(r2.proxy.type).toBe('socks5');
      expect(r2.proxy.username).toBe('u1');
      expect(r2.proxy.password).toBe('p1');
    }
  });

  it('giải mã đúng mật khẩu chứa ký tự đặc biệt (@ : # /) được mã hóa phần trăm trong URL', () => {
    const encoded = encodeURIComponent('p@ss:w#rd/1');
    const r = parseProxy(`http://user:${encoded}@198.51.100.1:8080`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proxy.password).toBe('p@ss:w#rd/1');
    }
  });

  it('tự loại bỏ khoảng trắng đầu/cuối và ký tự xuống dòng thừa', () => {
    const r = parseProxy('   \n\t 198.51.100.2:8080:usr:pwd \r\n  ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proxy.host).toBe('198.51.100.2');
      expect(r.proxy.port).toBe(8080);
      expect(r.proxy.username).toBe('usr');
      expect(r.proxy.password).toBe('pwd');
    }
  });

  it('trả lỗi tiếng Việt cho các chuỗi không hợp lệ (rỗng, thiếu port, port sai, scheme lạ, IPv6 thiếu ngoặc)', () => {
    const invalidCases = [
      '',
      '   ',
      '192.168.1.1',
      '192.168.1.1:abc',
      '192.168.1.1:0',
      '192.168.1.1:70000',
      'ftp://user:pass@192.168.1.1:21',
      '2001:db8::1:8080:user:pass',
    ];

    for (const raw of invalidCases) {
      const res = parseProxy(raw);
      expect(res.ok, `Mong đợi thất bại với "${raw}"`).toBe(false);
      if (!res.ok) {
        expect(res.error.length).toBeGreaterThan(5);
      }
    }

    const unbracketed = parseProxy('2001:db8::1:8080:user:pass');
    expect(unbracketed.ok).toBe(false);
    if (!unbracketed.ok) {
      expect(unbracketed.error).toContain('ngoặc vuông');
    }
  });

  it('phân tích đúng các giao thức mở rộng: socks4, socks4a, socks5h, ssh, ss, vmess, vless, trojan', () => {
    const s4 = parseProxy('socks4://10.0.0.1:1080');
    expect(s4.ok && s4.proxy.type).toBe('socks4');

    const s4a = parseProxy('socks4a://u1@10.0.0.2:1080');
    expect(s4a.ok && s4a.proxy.type).toBe('socks4a');

    const s5h = parseProxy('socks5h://u1:p1@proxy.example.com:1080');
    expect(s5h.ok && s5h.proxy.type).toBe('socks5h');

    const ssh = parseProxy('ssh://root:mysecret@203.0.113.5:22');
    expect(ssh.ok && ssh.proxy.type).toBe('ssh');
    if (ssh.ok) {
      expect(ssh.proxy.username).toBe('root');
      expect(ssh.proxy.password).toBe('mysecret');
    }

    const ssAuth = Buffer.from('aes-256-gcm:sspass').toString('base64');
    const ss = parseProxy(`ss://${ssAuth}@203.0.113.10:8388#SG`);
    expect(ss.ok && ss.proxy.type).toBe('shadowsocks');
    if (ss.ok) {
      expect(ss.proxy.extra?.['cipher']).toBe('aes-256-gcm');
      expect(ss.proxy.password).toBe('sspass');
    }

    const vmessPayload = Buffer.from(
      JSON.stringify({
        add: 'vmess.example.com',
        port: 443,
        id: '11111111-2222-3333-4444-555555555555',
        net: 'ws',
        tls: 'tls',
        sni: 'vmess.example.com',
        path: '/ws',
      }),
    ).toString('base64');
    const vmess = parseProxy(`vmess://${vmessPayload}`);
    expect(vmess.ok && vmess.proxy.type).toBe('vmess');
    if (vmess.ok) {
      expect(vmess.proxy.extra?.['uuid']).toBe('11111111-2222-3333-4444-555555555555');
      expect(vmess.proxy.extra?.['network']).toBe('ws');
    }

    const vless = parseProxy(
      'vless://11111111-2222-3333-4444-555555555555@vless.example.com:443?security=tls&type=ws&sni=vless.example.com&path=%2Fray',
    );
    expect(vless.ok && vless.proxy.type).toBe('vless');
    if (vless.ok) {
      expect(vless.proxy.extra?.['path']).toBe('/ray');
    }

    const trojan = parseProxy(
      'trojan://myTrojanPass@trojan.example.com:443?sni=trojan.example.com',
    );
    expect(trojan.ok && trojan.proxy.type).toBe('trojan');
    if (trojan.ok) {
      expect(trojan.proxy.password).toBe('myTrojanPass');
      expect(trojan.proxy.extra?.['sni']).toBe('trojan.example.com');
    }
  });

  it('báo lỗi tiếng Việt cụ thể khi ss cipher không hỗ trợ hoặc vmess/vless thiếu UUID', () => {
    const badCipher = parseProxy(
      `ss://${Buffer.from('fake-cipher:123').toString('base64')}@1.2.3.4:8388`,
    );
    expect(badCipher.ok).toBe(false);
    if (!badCipher.ok) expect(badCipher.error).toContain('cipher');

    const badVless = parseProxy('vless://not-a-uuid@example.com:443');
    expect(badVless.ok).toBe(false);
    if (!badVless.ok) expect(badVless.error).toContain('UUID');

    const badVmess = parseProxy(
      `vmess://${Buffer.from(JSON.stringify({ add: '1.2.3.4', port: 443 })).toString('base64')}`,
    );
    expect(badVmess.ok).toBe(false);
    if (!badVmess.ok) expect(badVmess.error).toContain('UUID');
  });
});
