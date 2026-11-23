import crypto from 'node:crypto';

export interface KdfParams {
  algo: 'scrypt';
  N: number;
  r: number;
  p: number;
  keyLen: number;
  maxmem: number;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algo: 'scrypt',
  N: 32768, // 2^15
  r: 8,
  p: 1,
  keyLen: 32,
  maxmem: 128 * 1024 * 1024,
};

const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function deriveKek(
  masterPassword: string,
  salt: Buffer,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Buffer {
  return crypto.scryptSync(Buffer.from(masterPassword, 'utf8'), salt, params.keyLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
}

export function generateDek(): Buffer {
  return crypto.randomBytes(32);
}

export function zeroizeBuffer(buf: Buffer | null | undefined): void {
  if (buf && Buffer.isBuffer(buf)) {
    buf.fill(0);
  }
}

export function encryptBuffer(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), nonce, tag, ciphertext]);
}

export function decryptBuffer(key: Buffer, envelope: Buffer, aad: string): Buffer {
  if (!envelope || envelope.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error('Dữ liệu mã hóa không hợp lệ');
  }
  const version = envelope[0];
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`Phiên bản mã hóa không được hỗ trợ: ${String(version)}`);
  }
  const nonce = envelope.subarray(1, 1 + NONCE_BYTES);
  const tag = envelope.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(1 + NONCE_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptField(dek: Buffer, plaintext: string, aad: string): Buffer | null {
  if (!plaintext) return null;
  return encryptBuffer(dek, Buffer.from(plaintext, 'utf8'), aad);
}

export function decryptField(dek: Buffer, blob: Buffer | null | undefined, aad: string): string {
  if (!blob || blob.length === 0) return '';
  return decryptBuffer(dek, blob, aad).toString('utf8');
}

export function wrapDek(kek: Buffer, dek: Buffer): Buffer {
  return encryptBuffer(kek, dek, 'meta:dek');
}

export function unwrapDek(kek: Buffer, wrapped: Buffer): Buffer {
  const unwrapped = decryptBuffer(kek, wrapped, 'meta:dek');
  if (unwrapped.length !== 32) {
    zeroizeBuffer(unwrapped);
    throw new Error('DEK không hợp lệ');
  }
  return unwrapped;
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '!@#$%^&*-_';
const ALL_POOL = LOWER + UPPER + DIGITS + SPECIAL;

/**
 * Cryptographically strong password generator using crypto.randomInt.
 * Guarantees at least one lowercase, uppercase, digit, and special character.
 */
export function generateStrongPassword(length = 20): string {
  const safeLen = Math.max(12, Math.min(128, Math.floor(length)));
  const chars: string[] = [
    LOWER[crypto.randomInt(0, LOWER.length)]!,
    UPPER[crypto.randomInt(0, UPPER.length)]!,
    DIGITS[crypto.randomInt(0, DIGITS.length)]!,
    SPECIAL[crypto.randomInt(0, SPECIAL.length)]!,
  ];
  while (chars.length < safeLen) {
    chars.push(ALL_POOL[crypto.randomInt(0, ALL_POOL.length)]!);
  }
  // Fisher-Yates shuffle with crypto.randomInt
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join('');
}
