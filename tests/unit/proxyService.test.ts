import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../electron/db';
import { SecretService } from '../../electron/services/secretService';
import {
  classifyProxyError,
  ProxyService,
  type ProxyHttpFetcher,
} from '../../electron/services/proxyService';
import {
  MOCK_IPAPI_VN,
  MOCK_IPWHO_DE_IPV6,
  SAMPLE_HTTP_PROXY,
} from '../fixtures/mockData';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Unit: proxyService.checkProxy', () => {
  it('chuẩn hóa đúng đầy đủ trường kết quả khi API thành công', async () => {
    const dbCtx = createDatabase(':memory:');
    const fetcher: ProxyHttpFetcher = async () => ({
      statusCode: 200,
      body: JSON.stringify(MOCK_IPAPI_VN),
    });
    const service = new ProxyService(dbCtx.db, new SecretService(null), fetcher);

    const res = await service.checkProxy(SAMPLE_HTTP_PROXY);
    expect(res.ok).toBe(true);
    expect(res.ip).toBe('203.0.113.25');
    expect(res.ipVersion).toBe(4);
    expect(res.country).toBe('Vietnam');
    expect(res.countryCode).toBe('VN');
    expect(res.city).toBe('Ho Chi Minh City');
    expect(res.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(res.lat).toBe(10.8231);
    expect(res.lon).toBe(106.6297);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    dbCtx.sqlite.close();
  });

  it('tự chuyển sang API dự phòng khi API đầu bị 429 hoặc lỗi, và báo lỗi rõ nếu cả 3 API đều lỗi', async () => {
    const dbCtx = createDatabase(':memory:');
    let calls = 0;
    const fallbackFetcher: ProxyHttpFetcher = async (url) => {
      calls += 1;
      if (url.includes('ipapi.co')) return { statusCode: 429, body: '{"error":true}' };
      if (url.includes('ip-api.com')) return { statusCode: 500, body: 'Internal Error' };
      return { statusCode: 200, body: JSON.stringify(MOCK_IPWHO_DE_IPV6) };
    };
    const svc1 = new ProxyService(dbCtx.db, new SecretService(null), fallbackFetcher);
    const okRes = await svc1.checkProxy(SAMPLE_HTTP_PROXY);
    expect(okRes.ok).toBe(true);
    expect(okRes.ip).toBe('2001:db8::99');
    expect(okRes.ipVersion).toBe(6);
    expect(calls).toBe(3);

    const allFailFetcher: ProxyHttpFetcher = async () => ({ statusCode: 503, body: 'Down' });
    const svc2 = new ProxyService(dbCtx.db, new SecretService(null), allFailFetcher);
    const failRes = await svc2.checkProxy(SAMPLE_HTTP_PROXY);
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toBeTruthy();
    dbCtx.sqlite.close();
  });

  it('phân loại chính xác lỗi ECONNREFUSED, ETIMEDOUT, ENOTFOUND, 407 và lỗi lạ sang tiếng Việt', () => {
    expect(classifyProxyError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toBe(
      'Proxy từ chối kết nối, kiểm tra host/port hoặc dịch vụ proxy',
    );
    expect(classifyProxyError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(
      'Hết thời gian chờ, proxy chậm hoặc bị chặn',
    );
    expect(classifyProxyError(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))).toBe(
      'Không tìm thấy host proxy',
    );
    expect(classifyProxyError(null, 407)).toBe('Sai tài khoản/mật khẩu hoặc chưa whitelist IP');
    expect(classifyProxyError(new Error('TLS handshake failed'))).toContain('TLS handshake failed');
  });

  it('truyền đúng timeout 15 giây cho mỗi lần thử (dùng fake timers)', async () => {
    vi.useFakeTimers();
    const dbCtx = createDatabase(':memory:');
    const seenTimeouts: number[] = [];

    const slowFetcher: ProxyHttpFetcher = (_url, _proxy, timeoutMs) => {
      seenTimeouts.push(timeoutMs);
      return new Promise((_resolve, reject) => {
        setTimeout(() => {
          const err = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
          reject(err);
        }, timeoutMs);
      });
    };

    const service = new ProxyService(dbCtx.db, new SecretService(null), slowFetcher);
    const promise = service.checkProxy(SAMPLE_HTTP_PROXY);
    await vi.advanceTimersByTimeAsync(15_000 * 3 + 100);
    const res = await promise;

    expect(seenTimeouts).toEqual([15_000, 15_000, 15_000]);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Hết thời gian chờ, proxy chậm hoặc bị chặn');
    dbCtx.sqlite.close();
  });

  it('cache kết quả trong 10 phút và tự gọi lại API sau khi hết hạn 10 phút', async () => {
    vi.useFakeTimers();
    const dbCtx = createDatabase(':memory:');
    let apiCalls = 0;

    const fetcher: ProxyHttpFetcher = async () => {
      apiCalls += 1;
      return { statusCode: 200, body: JSON.stringify(MOCK_IPAPI_VN) };
    };

    const service = new ProxyService(dbCtx.db, new SecretService(null), fetcher);
    await service.checkProxy(SAMPLE_HTTP_PROXY);
    expect(apiCalls).toBe(1);

    // Within 10 minutes: uses cache
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await service.checkProxy(SAMPLE_HTTP_PROXY);
    expect(apiCalls).toBe(1);

    // After 10 minutes: cache expires, calls API again
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    await service.checkProxy(SAMPLE_HTTP_PROXY);
    expect(apiCalls).toBe(2);

    dbCtx.sqlite.close();
  });

  it('không bao giờ để lộ mật khẩu proxy trong log console hoặc thông báo lỗi', async () => {
    const dbCtx = createDatabase(':memory:');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const leakingFetcher: ProxyHttpFetcher = async () => {
      throw new Error(
        `Proxy error at http://${SAMPLE_HTTP_PROXY.username}:${SAMPLE_HTTP_PROXY.password}@${SAMPLE_HTTP_PROXY.host}:${SAMPLE_HTTP_PROXY.port}`,
      );
    };

    const service = new ProxyService(dbCtx.db, new SecretService(null), leakingFetcher);
    const res = await service.checkProxy(SAMPLE_HTTP_PROXY);

    expect(res.ok).toBe(false);
    expect(res.error).not.toContain(SAMPLE_HTTP_PROXY.password);
    const allConsoleOutput = [
      ...logSpy.mock.calls,
      ...errSpy.mock.calls,
      ...warnSpy.mock.calls,
    ].join(' ');
    expect(allConsoleOutput).not.toContain(SAMPLE_HTTP_PROXY.password);
    dbCtx.sqlite.close();
  });
});
