import { generateSync, type HashAlgorithm } from 'otplib';
import type { TotpCodeResult } from '@shared/vaultTypes';

export interface ParsedTotpConfig {
  secret: string;
  digits: 6 | 7 | 8;
  period: number;
  algorithm: HashAlgorithm;
}

export function parseTotpInput(raw: string): ParsedTotpConfig {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Khóa bí mật 2FA trống');
  }

  if (/^otpauth:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('URI otpauth:// không hợp lệ');
    }
    const secret = (url.searchParams.get('secret') ?? '').replace(/\s+/g, '').toUpperCase();
    if (!secret) {
      throw new Error('URI otpauth:// thiếu tham số secret');
    }
    const digitsRaw = Number(url.searchParams.get('digits') ?? '6');
    const digits: 6 | 7 | 8 = digitsRaw === 7 ? 7 : digitsRaw === 8 ? 8 : 6;
    const periodRaw = Number(url.searchParams.get('period') ?? '30');
    const period = Number.isFinite(periodRaw) && periodRaw > 0 ? Math.floor(periodRaw) : 30;
    const algRaw = (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase();
    const algorithm: HashAlgorithm =
      algRaw === 'sha256' ? 'sha256' : algRaw === 'sha512' ? 'sha512' : 'sha1';
    return { secret, digits, period, algorithm };
  }

  const secret = trimmed.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(secret)) {
    throw new Error('Khóa bí mật 2FA không đúng định dạng Base32');
  }
  return { secret, digits: 6, period: 30, algorithm: 'sha1' };
}

export function generateTotpCode(
  rawSecretOrUri: string,
  epochSeconds?: number,
): TotpCodeResult {
  const cfg = parseTotpInput(rawSecretOrUri);
  const nowSec = epochSeconds !== undefined ? Math.floor(epochSeconds) : Math.floor(Date.now() / 1000);
  const code = generateSync({
    secret: cfg.secret,
    digits: cfg.digits,
    period: cfg.period,
    algorithm: cfg.algorithm,
    epoch: nowSec,
  });
  const remainingSeconds = cfg.period - (nowSec % cfg.period);
  return {
    code,
    remainingSeconds,
    period: cfg.period,
  };
}
