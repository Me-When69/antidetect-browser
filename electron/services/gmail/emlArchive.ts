import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const FACET_EML_MAGIC = 'FACET_EML' as const;
export const FACET_EML_VERSION = 1 as const;

export interface EmlArchiveEntry {
  name: string;
  content: Buffer;
}

export interface EncryptedEmlArchiveEnvelope {
  magic: typeof FACET_EML_MAGIC;
  version: typeof FACET_EML_VERSION;
  kdf: {
    alg: 'scrypt';
    N: number;
    r: number;
    p: number;
    dkLen: number;
  };
  salt: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

const DEFAULT_KDF = {
  alg: 'scrypt' as const,
  N: 32768,
  r: 8,
  p: 1,
  dkLen: 32,
};

const SCRYPT_MAXMEM = 128 * 1024 * 1024;

function makeEmlAad(magic: string, version: number): Buffer {
  return Buffer.from(`${magic}:v${version}`, 'utf8');
}

/**
 * Detect legacy PKZIP archives (from v0.2.0 archiver-zip-encrypted backups).
 * Legacy AES-256 .zip files remain standard WinZip AES-256 archives readable by 7-Zip / WinRAR.
 */
export function isLegacyZipArchive(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

/**
 * Pack and encrypt .eml messages into a zero-dependency AES-256-GCM + gzip
 * `.facet-eml` archive using Node built-in `crypto` and `zlib`.
 */
export function createEncryptedEmlArchive(
  entries: readonly EmlArchiveEntry[],
  password: string,
): Buffer {
  if (!password || password.length < 4) {
    throw new Error('Vui lòng nhập mật khẩu bảo vệ bản sao lưu (tối thiểu 4 ký tự)');
  }

  const bundleJson = JSON.stringify({
    entries: entries.map((e) => ({
      name: e.name,
      contentBase64: e.content.toString('base64'),
    })),
  });
  const compressed = zlib.gzipSync(Buffer.from(bundleJson, 'utf8'), { level: 6 });

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
    cipher.setAAD(makeEmlAad(FACET_EML_MAGIC, FACET_EML_VERSION));
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope: EncryptedEmlArchiveEnvelope = {
      magic: FACET_EML_MAGIC,
      version: FACET_EML_VERSION,
      kdf: { ...DEFAULT_KDF },
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return Buffer.from(JSON.stringify(envelope), 'utf8');
  } finally {
    key.fill(0);
  }
}

export function extractEncryptedEmlArchive(
  archiveBuffer: Buffer,
  password: string,
): EmlArchiveEntry[] {
  if (isLegacyZipArchive(archiveBuffer)) {
    throw new Error(
      'Đây là file sao lưu .zip AES-256 định dạng cũ (v0.2.0). Bạn có thể giải nén trực tiếp bằng 7-Zip hoặc WinRAR với mật khẩu đã đặt.',
    );
  }

  let parsed: EncryptedEmlArchiveEnvelope;
  try {
    parsed = JSON.parse(archiveBuffer.toString('utf8')) as EncryptedEmlArchiveEnvelope;
  } catch {
    throw new Error('File sao lưu .facet-eml không hợp lệ hoặc bị hỏng');
  }

  if (parsed.magic !== FACET_EML_MAGIC || parsed.version !== FACET_EML_VERSION) {
    throw new Error('Định dạng hoặc phiên bản file sao lưu .facet-eml không được hỗ trợ');
  }

  const salt = Buffer.from(parsed.salt, 'base64');
  const nonce = Buffer.from(parsed.nonce, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const ciphertext = Buffer.from(parsed.ciphertext, 'base64');

  const key = crypto.scryptSync(password, salt, parsed.kdf.dkLen, {
    N: parsed.kdf.N,
    r: parsed.kdf.r,
    p: parsed.kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(makeEmlAad(parsed.magic, parsed.version));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) as {
      entries: { name: string; contentBase64: string }[];
    };
    return bundle.entries.map((e) => ({
      name: e.name,
      content: Buffer.from(e.contentBase64, 'base64'),
    }));
  } catch {
    throw new Error('Sai mật khẩu giải mã hoặc file sao lưu .facet-eml đã bị chỉnh sửa/hỏng');
  } finally {
    key.fill(0);
  }
}

export interface ExtractEmlArchiveResult {
  extractedCount: number;
  outputDir: string;
  files: string[];
}

/**
 * Decrypt and extract a `.facet-eml` archive into `outputDir`, sanitizing every entry
 * filename with `path.basename` and verifying path containment to prevent traversal.
 */
export function extractEncryptedEmlArchiveToDir(
  archivePath: string,
  outputDir: string,
  password: string,
): ExtractEmlArchiveResult {
  if (!fs.existsSync(archivePath)) {
    throw new Error('Không tìm thấy tệp sao lưu .facet-eml đã chọn');
  }
  const raw = fs.readFileSync(archivePath);
  const entries = extractEncryptedEmlArchive(raw, password);

  const resolvedOut = path.resolve(outputDir);
  if (!fs.existsSync(resolvedOut)) {
    fs.mkdirSync(resolvedOut, { recursive: true });
  }

  const files: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const safeName = path.basename(entry.name.replace(/\\/g, '/')).replace(/[<>:"|?*]/g, '_');
    const finalName =
      safeName && safeName !== '.' && safeName !== '..' ? safeName : `msg_${i + 1}.eml`;
    const targetPath = path.resolve(resolvedOut, finalName);
    if (!targetPath.startsWith(resolvedOut + path.sep)) {
      throw new Error(`Tên tệp không hợp lệ trong bản sao lưu: ${entry.name}`);
    }
    fs.writeFileSync(targetPath, entry.content);
    files.push(finalName);
  }

  return {
    extractedCount: files.length,
    outputDir: resolvedOut,
    files,
  };
}
