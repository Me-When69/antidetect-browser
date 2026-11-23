import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEncryptedEmlArchive,
  extractEncryptedEmlArchive,
  extractEncryptedEmlArchiveToDir,
  isLegacyZipArchive,
} from '../../electron/services/gmail/emlArchive';

describe('PHA 1.4 / 1.9.3: .facet-eml AES-256-GCM + gzip archive', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('packs, encrypts, and extracts .eml entries and rejects wrong password / tamper / truncation', () => {
    const entries = [
      { name: '001_hello.eml', content: Buffer.from('From: a@example.com\r\n\r\nHello', 'utf8') },
      { name: '002_world.eml', content: Buffer.from('From: b@example.com\r\n\r\nWorld', 'utf8') },
    ];

    expect(() => createEncryptedEmlArchive(entries, '123')).toThrow(/tối thiểu 4 ký tự/);

    const archive = createEncryptedEmlArchive(entries, 'ArchivePass!2026');
    expect(isLegacyZipArchive(archive)).toBe(false);

    const extracted = extractEncryptedEmlArchive(archive, 'ArchivePass!2026');
    expect(extracted).toHaveLength(2);
    expect(extracted[0]?.name).toBe('001_hello.eml');
    expect(extracted[0]?.content.toString('utf8')).toContain('Hello');
    expect(extracted[1]?.content.toString('utf8')).toContain('World');

    // Wrong password
    expect(() => extractEncryptedEmlArchive(archive, 'WrongPass!2026')).toThrow(/Sai mật khẩu/);

    // Truncated buffer
    const truncated = archive.subarray(0, Math.floor(archive.length / 2));
    expect(() => extractEncryptedEmlArchive(truncated, 'ArchivePass!2026')).toThrow(/không hợp lệ/);

    // 1-byte tampered ciphertext
    const parsed = JSON.parse(archive.toString('utf8')) as {
      ciphertext: string;
      magic: string;
      version: number;
    };
    const ctBuf = Buffer.from(parsed.ciphertext, 'base64');
    ctBuf[0] = (ctBuf[0] ?? 0) ^ 0xff;
    const tampered = Buffer.from(
      JSON.stringify({ ...parsed, ciphertext: ctBuf.toString('base64') }),
      'utf8',
    );
    expect(() => extractEncryptedEmlArchive(tampered, 'ArchivePass!2026')).toThrow(/Sai mật khẩu/);

    // Unsupported version
    const badVer = Buffer.from(JSON.stringify({ ...parsed, version: 99 }), 'utf8');
    expect(() => extractEncryptedEmlArchive(badVer, 'ArchivePass!2026')).toThrow(
      /không được hỗ trợ/,
    );
  });

  it('detects legacy v0.2.0 PKZIP fixture and returns clear guidance', () => {
    const pkzipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    expect(isLegacyZipArchive(pkzipHeader)).toBe(true);
    expect(() => extractEncryptedEmlArchive(pkzipHeader, 'anypass')).toThrow(/7-Zip|WinRAR/);
  });

  it('extractEncryptedEmlArchiveToDir writes .eml files safely and blocks path traversal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-eml-'));
    tempDirs.push(root);

    const archivePath = path.join(root, 'backup.facet-eml');
    const outDir = path.join(root, 'extracted');

    const archive = createEncryptedEmlArchive(
      [
        { name: 'msg1.eml', content: Buffer.from('Subject: Safe 1\r\n\r\nBody 1', 'utf8') },
        {
          name: '../../evil_escape.eml',
          content: Buffer.from('Subject: Traversal\r\n\r\nBody 2', 'utf8'),
        },
      ],
      'ExtractPass!1',
    );
    fs.writeFileSync(archivePath, archive);

    const result = extractEncryptedEmlArchiveToDir(archivePath, outDir, 'ExtractPass!1');
    expect(result.extractedCount).toBe(2);
    expect(result.outputDir).toBe(outDir);
    expect(fs.existsSync(path.join(outDir, 'msg1.eml'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'evil_escape.eml'))).toBe(true);
    // Must NEVER escape outDir
    expect(fs.existsSync(path.join(root, 'evil_escape.eml'))).toBe(false);
  });
});
