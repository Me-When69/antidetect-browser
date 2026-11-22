import { describe, expect, it } from 'vitest';
import { deriveGeo, mapCountryToLocale } from '../../electron/services/geoService';

describe('Unit: deriveGeo & ánh xạ locale', () => {
  it('ánh xạ đúng countryCode (VN, US, JP, DE, FR, BR) và mặc định en-US khi mã không tồn tại', () => {
    expect(mapCountryToLocale('VN')).toEqual({
      locale: 'vi-VN',
      acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
    });
    expect(mapCountryToLocale('US').locale).toBe('en-US');
    expect(mapCountryToLocale('JP').locale).toBe('ja-JP');
    expect(mapCountryToLocale('DE').locale).toBe('de-DE');
    expect(mapCountryToLocale('FR').locale).toBe('fr-FR');
    expect(mapCountryToLocale('BR').locale).toBe('pt-BR');
    expect(mapCountryToLocale('XX')).toEqual({
      locale: 'en-US',
      acceptLanguage: 'en-US,en;q=0.9',
    });
  });

  it('tự suy ra múi giờ IANA hợp lệ từ lat/lon bằng tz-lookup khi API trả thiếu timezone', () => {
    const vn = deriveGeo({ countryCode: 'VN', timezone: '', lat: 10.8231, lon: 106.6297 }, 'p1');
    expect(vn.timezone).toBe('Asia/Ho_Chi_Minh');

    const jp = deriveGeo({ countryCode: 'JP', timezone: '', lat: 35.6762, lon: 139.6503 }, 'p2');
    expect(jp.timezone).toBe('Asia/Tokyo');
  });

  it('tạo nhiễu geolocation cố định theo profileId, khác nhau giữa các profile và lệch tối đa 0.01 độ', () => {
    const src = { countryCode: 'US', timezone: 'America/New_York', lat: 40.7128, lon: -74.006 };
    const a1 = deriveGeo(src, 'profile-001');
    const a2 = deriveGeo(src, 'profile-001');
    const b1 = deriveGeo(src, 'profile-002');

    expect(a1.geolocation).toEqual(a2.geolocation);
    expect(a1.geolocation).not.toEqual(b1.geolocation);
    expect(Math.abs((a1.geolocation?.latitude ?? 0) - src.lat)).toBeLessThanOrEqual(0.01);
    expect(Math.abs((a1.geolocation?.longitude ?? 0) - src.lon)).toBeLessThanOrEqual(0.01);
  });
});
