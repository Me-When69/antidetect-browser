import crypto from 'node:crypto';
import type { AccountSecurityIssue } from '@shared/vaultTypes';
import type { VaultService } from './vaultService';

/**
 * Small built-in dictionary of common weak passwords (all lowercase).
 * Checked in-memory during security audit; never exposed in output.
 */
const COMMON_PASSWORDS = new Set<string>([
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '123456789012',
  'password',
  'password123',
  'password1234',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'abc123',
  'abcdef123456',
  'admin',
  'admin123',
  'admin123456',
  'letmein',
  'welcome',
  'welcome123',
  'monkey',
  'dragon',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'master',
  'shadow',
  'michael',
  'jennifer',
  '111111',
  '000000',
  '654321',
  '666666',
  '88888888',
  '99999999',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword123',
  'qwerty123456',
  'vietnam123',
  'vietnam123456',
  'anhyeuem',
  'anhyeuem123',
  'matkhau123',
  'matkhau123456',
  'gmail123456',
  'google123456',
  'test123456',
  'changeme123',
]);

const OLD_PASSWORD_DAYS = 180;
const MIN_PASSWORD_LENGTH = 12;

export function isWeakPassword(password: string): { weak: boolean; reason: string } {
  if (!password) {
    return { weak: true, reason: 'Chưa lưu mật khẩu' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { weak: true, reason: 'Mật khẩu thuộc danh sách phổ biến dễ đoán' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      weak: true,
      reason: `Mật khẩu ngắn hơn ${MIN_PASSWORD_LENGTH} ký tự`,
    };
  }
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1;

  if (classes < 3) {
    return {
      weak: true,
      reason: 'Thiếu đa dạng ký tự (cần ít nhất 3 nhóm: chữ hoa, chữ thường, số, ký tự đặc biệt)',
    };
  }
  return { weak: false, reason: '' };
}

/**
 * Audit all accounts in the unlocked vault.
 * Plaintext passwords are NEVER included in returned issues, and password hashes
 * exist only in local memory for the duration of this call.
 */
export function auditVaultAccounts(
  vault: VaultService,
  nowSec = Math.floor(Date.now() / 1000),
): AccountSecurityIssue[] {
  const accounts = vault.listAccounts();
  const issues: AccountSecurityIssue[] = [];

  // In-memory map of SHA-256(password) -> list of emails sharing it
  const passwordHashToEmails = new Map<string, string[]>();

  for (const acc of accounts) {
    // 1. NO_2FA
    if (!acc.hasTotp) {
      issues.push({
        email: acc.email,
        code: 'NO_2FA',
        severity: 'high',
        message: 'Chưa cấu hình mã xác thực 2 bước (2FA TOTP)',
        suggestion: 'Bật 2FA trên Google và lưu khóa bí mật TOTP vào kho',
      });
    }

    // 2. OLD_PASSWORD (> 180 days)
    const ageDays = Math.floor((nowSec - acc.pwUpdatedAt) / 86400);
    if (ageDays > OLD_PASSWORD_DAYS) {
      issues.push({
        email: acc.email,
        code: 'OLD_PASSWORD',
        severity: 'medium',
        message: `Mật khẩu đã hơn ${ageDays} ngày chưa thay đổi (> ${OLD_PASSWORD_DAYS} ngày)`,
        suggestion: 'Sinh mật khẩu mới, cập nhật trên Google và bấm "Đã đổi mật khẩu"',
      });
    }

    // 3. NO_RECOVERY
    if (!acc.hasRecovery) {
      issues.push({
        email: acc.email,
        code: 'NO_RECOVERY',
        severity: 'medium',
        message: 'Chưa lưu email khôi phục',
        suggestion: 'Cập nhật email khôi phục để tránh mất quyền truy cập tài khoản',
      });
    }

    // 4. WEAK_PASSWORD + collect hash for REUSED_PASSWORD
    const password = vault.getAccountSecret(acc.email, 'password');
    const weakCheck = isWeakPassword(password);
    if (weakCheck.weak) {
      issues.push({
        email: acc.email,
        code: 'WEAK_PASSWORD',
        severity: 'high',
        message: `Mật khẩu yếu: ${weakCheck.reason}`,
        suggestion: 'Dùng trình sinh mật khẩu mạnh (>= 16 ký tự gồm đủ 4 nhóm ký tự)',
      });
    }

    if (password.length > 0) {
      const digest = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
      const list = passwordHashToEmails.get(digest) ?? [];
      list.push(acc.email);
      passwordHashToEmails.set(digest, list);
    }

    // 6. NO_GMAIL_API / 7. TOKEN_EXPIRED
    if (acc.needsReauth) {
      issues.push({
        email: acc.email,
        code: 'TOKEN_EXPIRED',
        severity: 'medium',
        message: 'Token Gmail API đã hết hạn hoặc bị thu hồi',
        suggestion: 'Nhấn "Cấp quyền lại" để kết nối lại Gmail API',
      });
    } else if (!acc.authorized) {
      issues.push({
        email: acc.email,
        code: 'NO_GMAIL_API',
        severity: 'low',
        message: 'Chưa cấp quyền Gmail API (không thể đọc hộp thư / sao lưu)',
        suggestion: 'Nhấn "Cấp quyền Gmail" nếu bạn cần xem thư hoặc sao lưu .eml',
      });
    }
  }

  // 5. REUSED_PASSWORD
  for (const emails of passwordHashToEmails.values()) {
    if (emails.length >= 2) {
      for (const email of emails) {
        issues.push({
          email,
          code: 'REUSED_PASSWORD',
          severity: 'high',
          message: `Mật khẩu bị dùng trùng trên ${emails.length} tài khoản`,
          suggestion: 'Đặt mật khẩu riêng biệt cho từng tài khoản Gmail',
        });
      }
    }
  }
  passwordHashToEmails.clear();

  // Sort by severity (high -> medium -> low), then email
  const rank: Record<AccountSecurityIssue['severity'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.email.localeCompare(b.email));

  return issues;
}
