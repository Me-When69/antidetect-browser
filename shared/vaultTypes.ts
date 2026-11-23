export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  lockedOutRemainingSec: number;
  autoLockMinutes: number;
  lockOnMinimize: boolean;
  hasGoogleCredentials: boolean;
  accountCount: number;
}

/**
 * Masked summary safe to send to Renderer via IPC.
 * NEVER includes plaintext password, TOTP secret, or OAuth tokens.
 */
export interface VaultAccountSummary {
  id: string;
  email: string;
  label: string;
  hasPassword: boolean;
  hasRecovery: boolean;
  hasTotp: boolean;
  hasNotes: boolean;
  allowModify: boolean;
  pwUpdatedAt: number;
  authorized: boolean;
  needsReauth: boolean;
  createdAt: string;
}

export interface VaultAccountCreateInput {
  email: string;
  label?: string;
  password?: string;
  recovery?: string;
  totp?: string;
  notes?: string;
  allowModify?: boolean;
}

export interface VaultAccountUpdateInput {
  email: string;
  label?: string;
  password?: string;
  recovery?: string;
  totp?: string;
  notes?: string;
  allowModify?: boolean;
}

export interface TotpCodeResult {
  code: string;
  remainingSeconds: number;
  period: number;
}

export interface LegacyImportResult {
  imported: number;
  overwritten: number;
  skipped: number;
  tokensImported: number;
  errors: string[];
}

export type SecurityIssueSeverity = 'high' | 'medium' | 'low';

export interface AccountSecurityIssue {
  email: string;
  code:
    | 'NO_2FA'
    | 'OLD_PASSWORD'
    | 'NO_RECOVERY'
    | 'WEAK_PASSWORD'
    | 'REUSED_PASSWORD'
    | 'NO_GMAIL_API'
    | 'TOKEN_EXPIRED';
  severity: SecurityIssueSeverity;
  message: string;
  suggestion: string;
}

export interface GmailMessageSummary {
  accountEmail: string;
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
}

export interface GmailBackupOptions {
  email: string;
  maxMessages: number;
  targetDir: string;
  encryptZip: boolean;
  zipPassword?: string;
}

export interface GmailBackupProgress {
  email: string;
  current: number;
  total: number;
  done?: boolean;
  cancelled?: boolean;
  outputPath?: string;
  error?: string;
}
