import type { ProfileProxy } from '@shared/types';

export const SAMPLE_HTTP_PROXY: ProfileProxy = {
  type: 'http',
  host: '198.51.100.10',
  port: 8080,
  username: 'proxyuser',
  password: 'SuperSecretPassword!@#',
};

export const SAMPLE_IPV6_PROXY: ProfileProxy = {
  type: 'socks5',
  host: '2001:db8::1',
  port: 1080,
  username: 'v6user',
  password: 'v6SecretPassword',
};

export const MOCK_IPAPI_VN = {
  ip: '203.0.113.25',
  country_name: 'Vietnam',
  country_code: 'VN',
  city: 'Ho Chi Minh City',
  timezone: 'Asia/Ho_Chi_Minh',
  latitude: 10.8231,
  longitude: 106.6297,
};

export const MOCK_IP_API_US = {
  status: 'success',
  query: '198.51.100.42',
  country: 'United States',
  countryCode: 'US',
  city: 'New York',
  timezone: 'America/New_York',
  lat: 40.7128,
  lon: -74.006,
};

export const MOCK_IPWHO_DE_IPV6 = {
  success: true,
  ip: '2001:db8::99',
  country: 'Germany',
  country_code: 'DE',
  city: 'Frankfurt',
  latitude: 50.1109,
  longitude: 8.6821,
  timezone: { id: 'Europe/Berlin' },
};
