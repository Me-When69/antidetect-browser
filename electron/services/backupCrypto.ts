import crypto from 'node:crypto';
import type { BackupPayload, ProfileProxy } from '@shared/types';

export const ENCRYPTED_BACKUP_MAGIC = 'FACET_BKP' as const;
export const ENCRYPTED_BACKUP_VERSION = 1 as const;

export interface BackupKdfParams {
  alg: 'scrypt';
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

export interface EncryptedBackupEnvelope {
  magic: typeof ENCRYPTED_BACKUP_MAGIC;
  version: typeof ENCRYPTED_BACKUP_VERSION;
  kdf: BackupKdfParams;
  salt: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export interface ExportBackupOptions {
  encrypt?: boolean;
  password?: string;
  excludeProxyPasswords?: boolean;
}

const DEFAULT_KDF: BackupKdfParams = {
  alg: 'scrypt',
  N: 32768,
  r: 8,
  p: 1,
  dkLen: 32,
};

const SCRYPT_MAXMEM = 128 * 1024 * 1024;

function makeBackupAad(magic: string, version: number): Buffer {
  return Buffer.from(`${magic}:v${version}`, 'utf8');
}

function stripProxySecret(proxy: ProfileProxy): ProfileProxy {
  return {
    ...proxy,
    username: '',
    password: '',
    ...(proxy.privateKey ? { privateKey: '' } : {}),
    ...(proxy.chain ? { chain: proxy.chain.map(stripProxySecret) } : {}),
  };
}

export function stripProxyCredentialsFromBackup(payload: BackupPayload): BackupPayload {
  return {
    ...payload,
    proxies: payload.proxies.map((p) => ({
      ...p,
      username: '',
      password: '',
    })),
    profiles: payload.profiles.map((prof) => ({
      ...prof,
      proxy: stripProxySecret(prof.proxy),
    })),
  };
}

export function isEncryptedBackupEnvelope(raw: unknown): raw is EncryptedBackupEnvelope {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return obj['magic'] === ENCRYPTED_BACKUP_MAGIC && typeof obj['ciphertext'] === 'string';
}

export function encryptBackupPayload(
  payload: BackupPayload,
  password: string,
): EncryptedBackupEnvelope {
  if (!password || password.length < 6) {
    throw new Error('Mật khẩu mã hóa sao lưu phải có ít nhất 6 ký tự');
  }

  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, DEFAULT_KDF.dkLen, {
    N: DEFAULT_KDF.N,
    r: DEFAULT_KDF.r,
    p: DEFAULT_KDF.p,
    maxmem: SCRYPT_MAXMEM,
  });

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(makeBackupAad(ENCRYPTED_BACKUP_MAGIC, ENCRYPTED_BACKUP_VERSION));
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      magic: ENCRYPTED_BACKUP_MAGIC,
      version: ENCRYPTED_BACKUP_VERSION,
      kdf: { ...DEFAULT_KDF },
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

export function decryptBackupEnvelope(
  envelope: EncryptedBackupEnvelope,
  password: string,
): BackupPayload {
  if (!password) {
    throw new Error('File sao lưu đã được mã hóa. Vui lòng nhập mật khẩu để giải mã.');
  }
  if (envelope.magic !== ENCRYPTED_BACKUP_MAGIC || envelope.version !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error('Định dạng hoặc phiên bản file sao lưu mã hóa không được hỗ trợ');
  }
  const kdf = envelope.kdf;
  if (
    !kdf ||
    kdf.alg !== 'scrypt' ||
    !Number.isInteger(kdf.N) ||
    kdf.N < 16384 ||
    kdf.N > 131072 ||
    !Number.isInteger(kdf.r) ||
    kdf.r < 1 ||
    kdf.r > 16 ||
    !Number.isInteger(kdf.p) ||
    kdf.p < 1 ||
    kdf.p > 8 ||
    kdf.dkLen !== 32
  ) {
    throw new Error('Tham số KDF trong file sao lưu không hợp lệ');
  }

  const salt = Buffer.from(envelope.salt, 'base64');
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  if (salt.length !== 16 || nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Header file sao lưu mã hóa bị hỏng hoặc thiếu dữ liệu');
  }

  const key = crypto.scryptSync(password, salt, kdf.dkLen, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(makeBackupAad(envelope.magic, envelope.version));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as BackupPayload;
  } catch {
    throw new Error('Sai mật khẩu giải mã hoặc file sao lưu đã bị chỉnh sửa/hỏng');
  } finally {
    key.fill(0);
  }
}
