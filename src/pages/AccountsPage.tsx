import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  Eye,
  FolderOpen,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  MailOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import type {
  AccountSecurityIssue,
  GmailBackupProgress,
  GmailMessageSummary,
  TotpCodeResult,
  VaultAccountSummary,
  VaultStatus,
} from '@shared/vaultTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/StatusBadge';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

type AccountsTab = 'accounts' | 'inbox' | 'audit' | 'backup';

function formatPasswordAge(pwUpdatedAt: number, isEn: boolean): string {
  const days = Math.max(0, Math.floor((Date.now() / 1000 - pwUpdatedAt) / 86400));
  if (days === 0) return isEn ? 'Today' : 'Hôm nay';
  return isEn ? `${days}d ago` : `${days} ngày trước`;
}

export function AccountsPage(): React.JSX.Element {
  const { locale, showToast, refreshProfileAccountLinks } = useAppStore();
  const isEn = locale === 'en';

  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AccountsTab>('accounts');

  // Unlock / init form
  const [masterPw, setMasterPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);

  // Accounts list
  const [accounts, setAccounts] = useState<VaultAccountSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<VaultAccountSummary | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRecovery, setFormRecovery] = useState('');
  const [formTotp, setFormTotp] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formAllowModify, setFormAllowModify] = useState(false);
  const [formBusy, setFormBusy] = useState(false);

  // TOTP live modal
  const [totpEmail, setTotpEmail] = useState<string | null>(null);
  const [totpData, setTotpData] = useState<TotpCodeResult | null>(null);

  // Temporary 10s password reveal modal
  const [revealEmail, setRevealEmail] = useState<string | null>(null);
  const [revealMasterPw, setRevealMasterPw] = useState('');
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [revealCountdown, setRevealCountdown] = useState(0);

  // Authorize Gmail modal
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authAllowModify, setAuthAllowModify] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  // Vault Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(10);
  const [lockOnMinimize, setLockOnMinimize] = useState(false);
  const [oldMasterPw, setOldMasterPw] = useState('');
  const [newMasterPw, setNewMasterPw] = useState('');
  const [legacyPw, setLegacyPw] = useState('');
  const [legacyMode, setLegacyMode] = useState<'skip' | 'overwrite'>('skip');
  const [legacyBusy, setLegacyBusy] = useState(false);

  // Inbox tab
  const [inboxAccount, setInboxAccount] = useState<string>('ALL');
  const [inboxQuery, setInboxQuery] = useState('in:inbox');
  const [inboxMessages, setInboxMessages] = useState<GmailMessageSummary[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [selectedMsgKeys, setSelectedMsgKeys] = useState<Set<string>>(new Set());

  // Audit tab
  const [auditIssues, setAuditIssues] = useState<AccountSecurityIssue[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRan, setAuditRan] = useState(false);

  // Backup tab
  const [backupEmail, setBackupEmail] = useState('');
  const [backupMax, setBackupMax] = useState(200);
  const [backupDir, setBackupDir] = useState('');
  const [backupEncryptZip, setBackupEncryptZip] = useState(true);
  const [backupZipPw, setBackupZipPw] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState<GmailBackupProgress | null>(null);

  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadVaultState = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    try {
      const st = await api.getVaultStatus();
      setStatus(st);
      setAutoLockMinutes(st.autoLockMinutes);
      setLockOnMinimize(st.lockOnMinimize);
      if (st.unlocked) {
        const list = await api.listVaultAccounts();
        setAccounts(list);
      } else {
        setAccounts([]);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tải trạng thái kho', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadVaultState();
    const api = window.electronAPI;
    if (!api) return;
    const unsubLock = api.onVaultLocked(() => {
      setAccounts([]);
      setInboxMessages([]);
      setAuditIssues([]);
      setRevealedPassword(null);
      setTotpEmail(null);
      void loadVaultState();
      showToast(
        isEn ? 'Vault automatically locked' : 'Kho tài khoản đã tự động khóa',
        'info',
      );
    });
    const unsubBackup = api.onGmailBackupProgress((progress) => {
      setBackupProgress(progress);
    });
    return () => {
      unsubLock();
      unsubBackup();
    };
  }, [isEn, loadVaultState, showToast]);

  // Live 1s countdown for TOTP modal
  useEffect(() => {
    if (!totpEmail) return;
    let active = true;
    const fetchTotp = async () => {
      try {
        const res = await window.electronAPI?.getAccountTotpCode(totpEmail);
        if (active && res) setTotpData(res);
      } catch (err) {
        if (active) {
          showToast(err instanceof Error ? err.message : 'Lỗi sinh mã 2FA', 'error');
          setTotpEmail(null);
        }
      }
    };
    void fetchTotp();
    const interval = setInterval(() => {
      void fetchTotp();
    }, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [totpEmail, showToast]);

  // Cleanup reveal timer on unmount
  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    };
  }, []);

  const handleUnlock = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const api = window.electronAPI;
    if (!api) return;
    if (!status?.initialized) {
      if (masterPw.length < 6) {
        showToast(
          isEn ? 'Master password must be at least 6 characters' : 'Mật khẩu chính tối thiểu 6 ký tự',
          'error',
        );
        return;
      }
      if (masterPw !== confirmPw) {
        showToast(
          isEn ? 'Passwords do not match' : 'Mật khẩu xác nhận không khớp',
          'error',
        );
        return;
      }
    }
    setUnlockBusy(true);
    try {
      const next = await api.unlockVault(masterPw);
      setMasterPw('');
      setConfirmPw('');
      setStatus(next);
      const list = await api.listVaultAccounts();
      setAccounts(list);
      showToast(isEn ? 'Vault unlocked' : 'Đã mở khóa kho tài khoản', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể mở khóa', 'error');
      const st = await api.getVaultStatus();
      setStatus(st);
    } finally {
      setUnlockBusy(false);
    }
  };

  const handleLock = async (): Promise<void> => {
    const api = window.electronAPI;
    if (!api) return;
    const st = await api.lockVault();
    setStatus(st);
    setAccounts([]);
    setInboxMessages([]);
    setAuditIssues([]);
    setRevealedPassword(null);
    setTotpEmail(null);
    showToast(isEn ? 'Vault locked' : 'Đã khóa kho tài khoản', 'info');
  };

  const openAddModal = (): void => {
    setEditingAccount(null);
    setFormEmail('');
    setFormLabel('');
    setFormPassword('');
    setFormRecovery('');
    setFormTotp('');
    setFormNotes('');
    setFormAllowModify(false);
    setFormOpen(true);
  };

  const openEditModal = async (acc: VaultAccountSummary): Promise<void> => {
    setEditingAccount(acc);
    setFormEmail(acc.email);
    setFormLabel(acc.label);
    setFormPassword('');
    setFormTotp('');
    setFormAllowModify(acc.allowModify);
    setFormRecovery('');
    setFormNotes('');
    setFormOpen(true);
    try {
      const details = await window.electronAPI?.getAccountNonCredDetails(acc.email);
      if (details) {
        setFormRecovery(details.recovery);
        setFormNotes(details.notes);
      }
    } catch {
      // Ignore detail fetch failure
    }
  };

  const handleGeneratePw = async (): Promise<void> => {
    const pw = await window.electronAPI?.generateStrongPassword(20);
    if (pw) setFormPassword(pw);
  };

  const handleSaveAccount = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const api = window.electronAPI;
    if (!api) return;
    setFormBusy(true);
    try {
      if (editingAccount) {
        await api.updateVaultAccount({
          email: editingAccount.email,
          label: formLabel,
          ...(formPassword ? { password: formPassword } : {}),
          recovery: formRecovery,
          ...(formTotp ? { totp: formTotp } : {}),
          notes: formNotes,
          allowModify: formAllowModify,
        });
        showToast(isEn ? 'Account updated' : 'Đã cập nhật tài khoản', 'success');
      } else {
        await api.addVaultAccount({
          email: formEmail,
          label: formLabel,
          password: formPassword,
          recovery: formRecovery,
          totp: formTotp,
          notes: formNotes,
          allowModify: formAllowModify,
        });
        showToast(isEn ? 'Account added' : 'Đã thêm tài khoản vào kho', 'success');
      }
      setFormOpen(false);
      setFormPassword('');
      setFormTotp('');
      const list = await api.listVaultAccounts();
      setAccounts(list);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu tài khoản', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const handleDeleteAccount = async (email: string): Promise<void> => {
    const confirmed = window.confirm(
      isEn
        ? `Delete ${email} from the encrypted vault and unlink from all browser profiles?`
        : `Xóa tài khoản ${email} khỏi kho mã hóa và gỡ liên kết khỏi tất cả hồ sơ trình duyệt?`,
    );
    if (!confirmed) return;
    try {
      await window.electronAPI?.deleteVaultAccount(email);
      const list = (await window.electronAPI?.listVaultAccounts()) ?? [];
      setAccounts(list);
      await refreshProfileAccountLinks();
      showToast(isEn ? 'Account deleted' : 'Đã xóa tài khoản', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xóa tài khoản', 'error');
    }
  };

  const handleCopyPassword = async (email: string): Promise<void> => {
    try {
      const res = await window.electronAPI?.copyAccountPassword(email);
      showToast(
        isEn
          ? `Password copied (auto-clears in ${res?.clearAfterSec ?? 20}s)`
          : `Đã chép mật khẩu (tự xóa clipboard sau ${res?.clearAfterSec ?? 20} giây)`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi chép mật khẩu', 'error');
    }
  };

  const handleCopyTotp = async (email: string): Promise<void> => {
    try {
      const res = await window.electronAPI?.copyAccountTotp(email);
      showToast(
        isEn
          ? `2FA code ${res?.code ?? ''} copied (auto-clears in 20s)`
          : `Đã chép mã 2FA ${res?.code ?? ''} (tự xóa sau 20 giây)`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi chép mã 2FA', 'error');
    }
  };

  const handleMarkPwChanged = async (email: string): Promise<void> => {
    try {
      await window.electronAPI?.markAccountPasswordChanged(email);
      const list = (await window.electronAPI?.listVaultAccounts()) ?? [];
      setAccounts(list);
      showToast(
        isEn ? 'Marked password as recently changed' : 'Đã cập nhật ngày đổi mật khẩu',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật', 'error');
    }
  };

  const handleRevealTemp = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!revealEmail) return;
    try {
      const res = await window.electronAPI?.revealAccountPasswordTemp(revealEmail, revealMasterPw);
      if (!res) return;
      setRevealMasterPw('');
      setRevealedPassword(res.password);
      setRevealCountdown(res.ttlSeconds);
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      revealTimerRef.current = setInterval(() => {
        setRevealCountdown((prev) => {
          if (prev <= 1) {
            if (revealTimerRef.current) clearInterval(revealTimerRef.current);
            setRevealedPassword(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sai mật khẩu chính', 'error');
    }
  };

  const handleAuthorizeGmail = async (): Promise<void> => {
    if (!authEmail) return;
    setAuthBusy(true);
    try {
      await window.electronAPI?.authorizeGmailAccount(authEmail, authAllowModify);
      const list = (await window.electronAPI?.listVaultAccounts()) ?? [];
      setAccounts(list);
      setAuthEmail(null);
      showToast(
        isEn ? 'Gmail API authorized successfully' : 'Đã cấp quyền Gmail API thành công',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cấp quyền Gmail API', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveVaultSettings = async (): Promise<void> => {
    try {
      const st = await window.electronAPI?.setVaultSettings({
        autoLockMinutes,
        lockOnMinimize,
      });
      if (st) setStatus(st);
      showToast(isEn ? 'Vault settings saved' : 'Đã lưu cài đặt kho', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu cài đặt', 'error');
    }
  };

  const handleChangeMasterPw = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await window.electronAPI?.changeVaultMasterPassword(oldMasterPw, newMasterPw);
      setOldMasterPw('');
      setNewMasterPw('');
      showToast(
        isEn ? 'Master password changed' : 'Đã đổi mật khẩu chính thành công',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi đổi mật khẩu chính', 'error');
    }
  };

  const handleImportGoogleCreds = async (): Promise<void> => {
    try {
      const res = await window.electronAPI?.importGoogleCredentialsFile();
      if (res?.ok) {
        const st = await window.electronAPI?.getVaultStatus();
        if (st) setStatus(st);
        showToast(
          isEn ? 'Imported Google credentials.json' : 'Đã nhập file credentials.json vào kho mã hóa',
          'success',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'File credentials.json không hợp lệ', 'error');
    }
  };

  const handleImportLegacy = async (): Promise<void> => {
    if (!legacyPw) {
      showToast(
        isEn ? 'Enter legacy vault master password' : 'Nhập mật khẩu chính của vault cũ',
        'error',
      );
      return;
    }
    setLegacyBusy(true);
    try {
      const res = await window.electronAPI?.importLegacyVaultDb(legacyPw, legacyMode);
      if (res && !res.cancelled) {
        setLegacyPw('');
        const list = (await window.electronAPI?.listVaultAccounts()) ?? [];
        setAccounts(list);
        showToast(
          isEn
            ? `Imported ${res.imported}, overwritten ${res.overwritten}, skipped ${res.skipped} (tokens: ${res.tokensImported})`
            : `Đã nhập ${res.imported}, ghi đè ${res.overwritten}, bỏ qua ${res.skipped} (token: ${res.tokensImported})`,
          'success',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi nhập vault cũ', 'error');
    } finally {
      setLegacyBusy(false);
    }
  };

  // ---- Inbox actions ----
  const authorizedAccounts = useMemo(
    () => accounts.filter((a) => a.authorized && !a.needsReauth),
    [accounts],
  );

  const handleSearchInbox = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    const targetEmails =
      inboxAccount === 'ALL' ? authorizedAccounts.map((a) => a.email) : [inboxAccount];
    if (targetEmails.length === 0) {
      showToast(
        isEn ? 'No authorized Gmail accounts yet' : 'Chưa có tài khoản nào được cấp quyền Gmail API',
        'error',
      );
      return;
    }
    setInboxLoading(true);
    setSelectedMsgKeys(new Set());
    try {
      const msgs =
        (await window.electronAPI?.searchGmailMessages(targetEmails, inboxQuery, 25)) ?? [];
      setInboxMessages(msgs);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tìm thư', 'error');
    } finally {
      setInboxLoading(false);
    }
  };

  const handleBatchModify = async (
    actionLabel: string,
    addLabels: string[],
    removeLabels: string[],
  ): Promise<void> => {
    if (selectedMsgKeys.size === 0) return;
    const confirmed = window.confirm(
      isEn
        ? `Apply "${actionLabel}" to ${selectedMsgKeys.size} selected message(s)?`
        : `Xác nhận thực hiện "${actionLabel}" trên ${selectedMsgKeys.size} thư đã chọn?`,
    );
    if (!confirmed) return;

    const byAccount = new Map<string, string[]>();
    for (const key of selectedMsgKeys) {
      const [email, id] = key.split('::');
      if (!email || !id) continue;
      const list = byAccount.get(email) ?? [];
      list.push(id);
      byAccount.set(email, list);
    }

    try {
      for (const [email, ids] of byAccount.entries()) {
        await window.electronAPI?.batchModifyGmailMessages(email, ids, addLabels, removeLabels);
      }
      showToast(
        isEn
          ? `Updated ${selectedMsgKeys.size} message(s)`
          : `Đã cập nhật ${selectedMsgKeys.size} thư`,
        'success',
      );
      await handleSearchInbox();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi cập nhật thư', 'error');
    }
  };

  // ---- Audit ----
  const handleRunAudit = async (): Promise<void> => {
    setAuditLoading(true);
    try {
      const issues = (await window.electronAPI?.auditVaultSecurity()) ?? [];
      setAuditIssues(issues);
      setAuditRan(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi kiểm tra bảo mật', 'error');
    } finally {
      setAuditLoading(false);
    }
  };

  // ---- Backup ----
  const handleSelectBackupDir = async (): Promise<void> => {
    const dir = await window.electronAPI?.selectGmailBackupFolder();
    if (dir) setBackupDir(dir);
  };

  const handleStartBackup = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!backupEmail) {
      showToast(isEn ? 'Select an account' : 'Chọn tài khoản cần sao lưu', 'error');
      return;
    }
    if (!backupDir) {
      showToast(isEn ? 'Select target folder' : 'Chọn thư mục lưu sao lưu', 'error');
      return;
    }
    setBackupBusy(true);
    setBackupProgress(null);
    try {
      const res = await window.electronAPI?.backupGmailEmails({
        email: backupEmail,
        maxMessages: backupMax,
        targetDir: backupDir,
        encryptZip: backupEncryptZip,
        zipPassword: backupEncryptZip ? backupZipPw : undefined,
      });
      if (res?.cancelled) {
        showToast(isEn ? 'Backup cancelled' : 'Đã hủy sao lưu', 'info');
      } else if (res?.done) {
        showToast(
          isEn
            ? `Backed up ${res.current} emails to ${res.outputPath}`
            : `Đã sao lưu ${res.current} thư vào ${res.outputPath}`,
          'success',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi sao lưu thư', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.email.toLowerCase().includes(q) || a.label.toLowerCase().includes(q),
    );
  }, [accounts, searchQuery]);

  if (loading && !status) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        {isEn ? 'Loading encrypted vault...' : 'Đang tải kho tài khoản mã hóa...'}
      </div>
    );
  }

  // ---- LOCKED / FIRST-TIME SETUP SCREEN ----
  if (!status?.unlocked) {
    const isInit = Boolean(status?.initialized);
    return (
      <div className="mx-auto mt-10 max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isInit
                ? isEn
                  ? 'Unlock Gmail Vault'
                  : 'Mở khóa kho tài khoản'
                : isEn
                  ? 'Create Master Password'
                  : 'Tạo mật khẩu chính cho kho'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isEn
                ? 'Local AES-256-GCM envelope encryption (vault.db)'
                : 'Mã hóa cục bộ AES-256-GCM theo mô hình phong bì (vault.db)'}
            </p>
          </div>
        </div>

        {!isInit && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>
                {isEn
                  ? 'Important: Facet cannot recover your master password. If you forget it, all encrypted accounts in vault.db will be permanently unreadable.'
                  : 'Quan trọng: Facet không lưu mật khẩu chính và KHÔNG THỂ khôi phục nếu bạn quên. Hãy ghi nhớ hoặc lưu ở nơi an toàn.'}
              </p>
            </div>
          </div>
        )}

        {status && status.lockedOutRemainingSec > 0 && (
          <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/15 p-3 text-xs text-destructive">
            {isEn
              ? `Too many failed attempts. Try again in ${status.lockedOutRemainingSec}s.`
              : `Nhập sai quá nhiều lần. Vui lòng thử lại sau ${status.lockedOutRemainingSec} giây.`}
          </div>
        )}

        <form onSubmit={(e) => void handleUnlock(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {isEn ? 'Master password' : 'Mật khẩu chính'}
            </label>
            <Input
              type="password"
              autoFocus
              value={masterPw}
              onChange={(e) => setMasterPw(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          {!isInit && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {isEn ? 'Confirm master password' : 'Xác nhận mật khẩu chính'}
              </label>
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="••••••••••••"
                required
              />
            </div>
          )}

          <Button type="submit" className="w-full gap-2" disabled={unlockBusy}>
            <Unlock className="h-4 w-4" />
            <span>
              {isInit
                ? isEn
                  ? 'Unlock Vault'
                  : 'Mở khóa kho'
                : isEn
                  ? 'Initialize Encrypted Vault'
                  : 'Khởi tạo kho mã hóa'}
            </span>
          </Button>
        </form>
      </div>
    );
  }

  // ---- UNLOCKED WORKSPACE ----
  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(
            [
              { id: 'accounts', label: isEn ? 'Accounts' : 'Tài khoản', icon: Mail },
              { id: 'inbox', label: isEn ? 'Inbox' : 'Hộp thư', icon: Inbox },
              { id: 'audit', label: isEn ? 'Security Audit' : 'Kiểm tra bảo mật', icon: ShieldCheck },
              { id: 'backup', label: isEn ? 'Backup' : 'Sao lưu', icon: Download },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'audit' && !auditRan) {
                    void handleRunAudit();
                  }
                }}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors',
                  activeTab === tab.id
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {!status.hasGoogleCredentials && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[11px]">
              {isEn ? 'Missing credentials.json' : 'Chưa nhập credentials.json'}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="gap-1.5"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>{isEn ? 'Vault Settings' : 'Cài đặt kho'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleLock()} className="gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            <span>{isEn ? 'Lock' : 'Khóa kho'}</span>
          </Button>
        </div>
      </div>

      {/* TAB 1: ACCOUNTS */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isEn ? 'Filter by email or label...' : 'Tìm theo email hoặc nhãn...'}
                className="pl-8"
              />
            </div>
            <Button onClick={openAddModal} className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>{isEn ? 'Add Account' : 'Thêm tài khoản'}</span>
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">{isEn ? 'Label' : 'Nhãn'}</th>
                  <th className="px-4 py-3 font-medium">{isEn ? 'Protection' : 'Bảo vệ'}</th>
                  <th className="px-4 py-3 font-medium">{isEn ? 'Password Age' : 'Tuổi mật khẩu'}</th>
                  <th className="px-4 py-3 font-medium">Gmail API</th>
                  <th className="px-4 py-3 text-right font-medium">{isEn ? 'Actions' : 'Thao tác'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {isEn
                        ? 'No accounts in vault yet. Click "Add Account" to start.'
                        : 'Chưa có tài khoản nào trong kho. Nhấn "Thêm tài khoản" để bắt đầu.'}
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium text-foreground">{acc.email}</td>
                      <td className="px-4 py-3 text-muted-foreground">{acc.label || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {acc.hasTotp ? (
                            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                              2FA
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {isEn ? 'No 2FA' : 'Chưa 2FA'}
                            </Badge>
                          )}
                          {acc.hasRecovery && (
                            <Badge variant="outline" className="text-[10px]">
                              {isEn ? 'Recovery' : 'Khôi phục'}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">
                        {formatPasswordAge(acc.pwUpdatedAt, isEn)}
                      </td>
                      <td className="px-4 py-3">
                        {acc.needsReauth ? (
                          <StatusBadge variant="warning">
                            {isEn ? 'Re-auth needed' : 'Cần cấp quyền lại'}
                          </StatusBadge>
                        ) : acc.authorized ? (
                          <StatusBadge variant="ready">
                            {acc.allowModify
                              ? isEn
                                ? 'Ready (Modify)'
                                : 'Sẵn sàng (Sửa)'
                              : isEn
                                ? 'Ready (Read)'
                                : 'Sẵn sàng (Đọc)'}
                          </StatusBadge>
                        ) : (
                          <StatusBadge variant="stopped">
                            {isEn ? 'Not connected' : 'Chưa kết nối'}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title={isEn ? 'Copy password (auto-clears in 20s)' : 'Chép mật khẩu (tự xóa sau 20s)'}
                            onClick={() => void handleCopyPassword(acc.email)}
                            disabled={!acc.hasPassword}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title={isEn ? 'Show / Copy 2FA TOTP' : 'Xem / Chép mã 2FA'}
                            onClick={() => setTotpEmail(acc.email)}
                            disabled={!acc.hasTotp}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title={isEn ? 'Reveal password (10s)' : 'Hiện mật khẩu tạm 10 giây'}
                            onClick={() => {
                              setRevealEmail(acc.email);
                              setRevealedPassword(null);
                              setRevealMasterPw('');
                            }}
                            disabled={!acc.hasPassword}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title={isEn ? 'Mark password changed today' : 'Đánh dấu đã đổi mật khẩu hôm nay'}
                            onClick={() => void handleMarkPwChanged(acc.email)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              setAuthEmail(acc.email);
                              setAuthAllowModify(acc.allowModify);
                            }}
                          >
                            {acc.needsReauth
                              ? isEn
                                ? 'Re-auth'
                                : 'Cấp lại'
                              : acc.authorized
                                ? 'API'
                                : isEn
                                  ? 'Authorize'
                                  : 'Cấp quyền'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title={isEn ? 'Edit' : 'Sửa'}
                            onClick={() => void openEditModal(acc)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            title={isEn ? 'Delete' : 'Xóa'}
                            onClick={() => void handleDeleteAccount(acc.email)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: INBOX */}
      {activeTab === 'inbox' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleSearchInbox(e)}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
          >
            <select
              value={inboxAccount}
              onChange={(e) => setInboxAccount(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground"
            >
              <option value="ALL">
                {isEn
                  ? `All authorized (${authorizedAccounts.length})`
                  : `Tất cả đã cấp quyền (${authorizedAccounts.length})`}
              </option>
              {authorizedAccounts.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.email}
                </option>
              ))}
            </select>
            <Input
              value={inboxQuery}
              onChange={(e) => setInboxQuery(e.target.value)}
              placeholder="in:inbox is:unread from:google..."
              className="min-w-[240px] flex-1"
            />
            <Button type="submit" disabled={inboxLoading} className="gap-1.5">
              <Search className="h-3.5 w-3.5" />
              <span>{isEn ? 'Search' : 'Tìm thư'}</span>
            </Button>
            {inboxLoading && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void window.electronAPI?.cancelGmailSearch()}
              >
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
            )}
          </form>

          {selectedMsgKeys.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
              <span className="font-medium text-primary">
                {selectedMsgKeys.size} {isEn ? 'selected' : 'thư đã chọn'}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                onClick={() =>
                  void handleBatchModify(isEn ? 'Mark Read' : 'Đánh dấu đã đọc', [], ['UNREAD'])
                }
              >
                <MailOpen className="h-3 w-3" />
                {isEn ? 'Mark Read' : 'Đã đọc'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                onClick={() =>
                  void handleBatchModify(isEn ? 'Star' : 'Gắn sao', ['STARRED'], [])
                }
              >
                <Star className="h-3 w-3" />
                {isEn ? 'Star' : 'Gắn sao'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                onClick={() =>
                  void handleBatchModify(isEn ? 'Archive' : 'Lưu trữ', [], ['INBOX'])
                }
              >
                <Archive className="h-3 w-3" />
                {isEn ? 'Archive' : 'Lưu trữ'}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1"
                onClick={() =>
                  void handleBatchModify(isEn ? 'Move to Trash' : 'Chuyển vào Thùng rác', ['TRASH'], ['INBOX'])
                }
              >
                <Trash2 className="h-3 w-3" />
                {isEn ? 'Trash' : 'Xóa vào thùng rác'}
              </Button>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">{isEn ? 'Account' : 'Tài khoản'}</th>
                  <th className="px-3 py-2.5 font-medium">{isEn ? 'From' : 'Người gửi'}</th>
                  <th className="px-3 py-2.5 font-medium">{isEn ? 'Subject' : 'Tiêu đề'}</th>
                  <th className="px-3 py-2.5 font-medium">{isEn ? 'Date' : 'Ngày'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inboxMessages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      {inboxLoading
                        ? isEn
                          ? 'Searching Gmail...'
                          : 'Đang tìm thư...'
                        : isEn
                          ? 'Click "Search" to fetch messages from authorized accounts (kept in memory only).'
                          : 'Nhấn "Tìm thư" để đọc hộp thư từ các tài khoản đã cấp quyền (chỉ giữ trong RAM, không lưu ra ổ đĩa).'}
                    </td>
                  </tr>
                ) : (
                  inboxMessages.map((msg) => {
                    const key = `${msg.accountEmail}::${msg.id}`;
                    const checked = selectedMsgKeys.has(key);
                    return (
                      <tr key={key} className="hover:bg-accent/30">
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedMsgKeys((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(key);
                                else next.delete(key);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                          {msg.accountEmail}
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 text-foreground">
                          {msg.from}
                        </td>
                        <td className="max-w-[360px] px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {msg.unread && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                            )}
                            {msg.starred && <Star className="h-3 w-3 shrink-0 text-amber-400" />}
                            <span className={cn('truncate', msg.unread && 'font-semibold')}>
                              {msg.subject}
                            </span>
                          </div>
                          {msg.snippet && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {msg.snippet}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {msg.date}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SECURITY AUDIT */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {isEn ? 'Account Security Audit' : 'Kiểm tra bảo mật tài khoản'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {isEn
                  ? 'Checks 2FA, password strength, reuse (in-memory hash), age > 180d, recovery email, and Gmail token health.'
                  : 'Kiểm tra 2FA, độ mạnh mật khẩu, trùng lặp (hash trong RAM), tuổi > 180 ngày, mail khôi phục và trạng thái token Gmail.'}
              </p>
            </div>
            <Button onClick={() => void handleRunAudit()} disabled={auditLoading} className="gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', auditLoading && 'animate-spin')} />
              <span>{isEn ? 'Run Audit' : 'Quét bảo mật'}</span>
            </Button>
          </div>

          {auditRan && auditIssues.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-5 text-sm text-primary">
              <ShieldCheck className="h-5 w-5" />
              <span>
                {isEn
                  ? 'Great! No security issues found across your accounts.'
                  : 'Tuyệt vời! Không phát hiện vấn đề bảo mật nào.'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {auditIssues.map((issue, idx) => (
                <div
                  key={`${issue.email}-${issue.code}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <ShieldAlert
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        issue.severity === 'high'
                          ? 'text-destructive'
                          : issue.severity === 'medium'
                            ? 'text-amber-400'
                            : 'text-muted-foreground',
                      )}
                    />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{issue.email}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] uppercase',
                            issue.severity === 'high'
                              ? 'border-destructive/50 text-destructive'
                              : issue.severity === 'medium'
                                ? 'border-amber-500/50 text-amber-400'
                                : 'text-muted-foreground',
                          )}
                        >
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground">{issue.message}</p>
                      <p className="text-[11px] text-muted-foreground">{issue.suggestion}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const target = accounts.find((a) => a.email === issue.email);
                      if (!target) return;
                      if (issue.code === 'NO_GMAIL_API' || issue.code === 'TOKEN_EXPIRED') {
                        setAuthEmail(target.email);
                        setAuthAllowModify(target.allowModify);
                      } else {
                        void openEditModal(target);
                      }
                    }}
                  >
                    {isEn ? 'Fix' : 'Khắc phục'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: BACKUP */}
      {activeTab === 'backup' && (
        <form
          onSubmit={(e) => void handleStartBackup(e)}
          className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-5"
        >
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {isEn ? 'Backup Emails (.eml)' : 'Sao lưu thư (.eml)'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isEn
                ? 'Downloads raw messages via Gmail API and packs them into an AES-256 encrypted ZIP by default.'
                : 'Tải thư gốc qua Gmail API và nén mặc định thành file .zip mã hóa AES-256.'}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {isEn ? 'Account' : 'Tài khoản'}
              </label>
              <select
                value={backupEmail}
                onChange={(e) => setBackupEmail(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground"
                required
              >
                <option value="">
                  {isEn ? '-- Select authorized account --' : '-- Chọn tài khoản đã cấp quyền --'}
                </option>
                {authorizedAccounts.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {isEn ? 'Max messages (1 - 5000)' : 'Số thư tối đa (1 - 5000)'}
              </label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={backupMax}
                onChange={(e) => setBackupMax(Number(e.target.value) || 1)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {isEn ? 'Target folder' : 'Thư mục lưu'}
              </label>
              <div className="flex gap-2">
                <Input value={backupDir} readOnly placeholder={isEn ? 'Choose folder...' : 'Chọn thư mục...'} />
                <Button type="button" variant="outline" onClick={() => void handleSelectBackupDir()}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={backupEncryptZip}
                onChange={(e) => setBackupEncryptZip(e.target.checked)}
              />
              <span>
                {isEn
                  ? 'Pack into AES-256 encrypted .zip (Recommended)'
                  : 'Nén thành file .zip mã hóa AES-256 (Khuyến nghị)'}
              </span>
            </label>

            {backupEncryptZip ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {isEn ? 'ZIP encryption password' : 'Mật khẩu bảo vệ file ZIP'}
                </label>
                <Input
                  type="password"
                  value={backupZipPw}
                  onChange={(e) => setBackupZipPw(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                {isEn
                  ? 'Warning: Unencrypted .eml files will be saved in plaintext on your disk.'
                  : 'Cảnh báo bảo mật: Thư .eml sẽ được lưu dạng chữ rõ trên ổ đĩa mà không mã hóa.'}
              </div>
            )}
          </div>

          {backupProgress && (
            <div className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
              <div className="flex justify-between">
                <span>{backupProgress.email}</span>
                <span className="font-mono">
                  {backupProgress.current} / {backupProgress.total}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${backupProgress.total > 0 ? Math.round((backupProgress.current / backupProgress.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={backupBusy} className="gap-1.5">
              <Download className="h-4 w-4" />
              <span>{isEn ? 'Start Backup' : 'Bắt đầu sao lưu'}</span>
            </Button>
            {backupBusy && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void window.electronAPI?.cancelGmailBackup()}
              >
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
            )}
          </div>
        </form>
      )}

      {/* MODAL: ADD / EDIT ACCOUNT */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {editingAccount
                  ? isEn
                    ? `Edit ${editingAccount.email}`
                    : `Sửa ${editingAccount.email}`
                  : isEn
                    ? 'Add Gmail Account'
                    : 'Thêm tài khoản Gmail'}
              </h3>
              <button type="button" onClick={() => setFormOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveAccount(e)} className="space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">Email</label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  disabled={Boolean(editingAccount)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  {isEn ? 'Label' : 'Nhãn'}
                </label>
                <Input value={formLabel} onChange={(e) => setFormLabel(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  {editingAccount
                    ? isEn
                      ? 'New Password (leave blank to keep current)'
                      : 'Mật khẩu mới (để trống nếu không đổi)'
                    : isEn
                      ? 'Password'
                      : 'Mật khẩu'}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="••••••••••••"
                  />
                  <Button type="button" variant="outline" onClick={() => void handleGeneratePw()}>
                    {isEn ? 'Generate' : 'Sinh MK'}
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  {isEn ? 'Recovery Email (encrypted)' : 'Email khôi phục (mã hóa)'}
                </label>
                <Input value={formRecovery} onChange={(e) => setFormRecovery(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  {editingAccount
                    ? isEn
                      ? 'New 2FA TOTP Secret or otpauth:// URI (leave blank to keep current)'
                      : 'Khóa 2FA TOTP mới hoặc otpauth:// (để trống nếu giữ nguyên)'
                    : isEn
                      ? '2FA TOTP Secret (Base32 or otpauth:// URI)'
                      : 'Khóa bí mật 2FA TOTP (Base32 hoặc otpauth://)'}
                </label>
                <Input
                  type="password"
                  value={formTotp}
                  onChange={(e) => setFormTotp(e.target.value)}
                  placeholder="JBSWY3DPEHPK3PXP"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-muted-foreground">
                  {isEn ? 'Notes (encrypted)' : 'Ghi chú (mã hóa)'}
                </label>
                <textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground"
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formAllowModify}
                  onChange={(e) => setFormAllowModify(e.target.checked)}
                />
                <span>
                  {isEn
                    ? 'Allow inbox modification (gmail.modify for labels/archive/trash — never gmail.send)'
                    : 'Cho phép chỉnh sửa hộp thư (gmail.modify để gắn nhãn/lưu trữ/xóa — không bao giờ xin gmail.send)'}
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                  {isEn ? 'Cancel' : 'Hủy'}
                </Button>
                <Button type="submit" disabled={formBusy}>
                  {isEn ? 'Save' : 'Lưu'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LIVE 2FA TOTP */}
      {totpEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow-xl">
            <h3 className="text-sm font-semibold">{totpEmail}</h3>
            <p className="mt-1 text-xs text-muted-foreground">2FA TOTP</p>
            <div className="my-4 font-mono text-3xl font-bold tracking-[0.25em] text-primary">
              {totpData ? `${totpData.code.slice(0, 3)} ${totpData.code.slice(3)}` : '--- ---'}
            </div>
            <p className="text-xs text-muted-foreground">
              {isEn
                ? `Refreshes in ${totpData?.remainingSeconds ?? 0}s`
                : `Đổi mã sau ${totpData?.remainingSeconds ?? 0} giây`}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => void handleCopyTotp(totpEmail)} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                <span>{isEn ? 'Copy Code' : 'Chép mã'}</span>
              </Button>
              <Button variant="outline" onClick={() => setTotpEmail(null)}>
                {isEn ? 'Close' : 'Đóng'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TEMPORARY 10s PASSWORD REVEAL */}
      {revealEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="mb-2 text-sm font-semibold">
              {isEn ? 'Temporary Password Reveal (10s)' : 'Hiện mật khẩu tạm thời (10 giây)'}
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">{revealEmail}</p>
            {revealedPassword !== null ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-primary/40 bg-background p-3 font-mono text-sm break-all text-primary">
                  {revealedPassword}
                </div>
                <p className="text-xs text-amber-400">
                  {isEn
                    ? `Auto-hides in ${revealCountdown}s`
                    : `Tự động ẩn sau ${revealCountdown} giây`}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setRevealedPassword(null);
                    setRevealEmail(null);
                  }}
                >
                  {isEn ? 'Hide & Close' : 'Ẩn & Đóng'}
                </Button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleRevealTemp(e)} className="space-y-3">
                <Input
                  type="password"
                  autoFocus
                  value={revealMasterPw}
                  onChange={(e) => setRevealMasterPw(e.target.value)}
                  placeholder={isEn ? 'Re-enter master password' : 'Nhập lại mật khẩu chính'}
                  required
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setRevealEmail(null)}>
                    {isEn ? 'Cancel' : 'Hủy'}
                  </Button>
                  <Button type="submit">{isEn ? 'Reveal 10s' : 'Hiện 10 giây'}</Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL: AUTHORIZE GMAIL API */}
      {authEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold">
              {isEn ? `Authorize Gmail API — ${authEmail}` : `Cấp quyền Gmail API — ${authEmail}`}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isEn
                ? 'Facet opens your system browser to Google OAuth consent with PKCE. Facet NEVER requests gmail.send.'
                : 'Facet sẽ mở trình duyệt hệ thống tới trang cấp quyền Google OAuth (PKCE). Facet KHÔNG BAO GIỜ yêu cầu quyền gửi thư (gmail.send).'}
            </p>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              {isEn
                ? 'Note: If your Google Cloud OAuth app is in "Testing" mode, refresh tokens expire after 7 days and require re-authorization.'
                : 'Lưu ý: Nếu ứng dụng OAuth trên Google Cloud đang ở chế độ Testing, refresh token sẽ hết hạn sau 7 ngày và cần cấp quyền lại.'}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={authAllowModify}
                onChange={(e) => setAuthAllowModify(e.target.checked)}
              />
              <span>
                {isEn
                  ? 'Request gmail.modify (optional: mark read, star, archive, trash)'
                  : 'Xin thêm quyền gmail.modify (tùy chọn: đánh dấu đã đọc, sao, lưu trữ, thùng rác)'}
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAuthEmail(null)} disabled={authBusy}>
                {isEn ? 'Cancel' : 'Hủy'}
              </Button>
              <Button onClick={() => void handleAuthorizeGmail()} disabled={authBusy}>
                {authBusy
                  ? isEn
                    ? 'Waiting for browser...'
                    : 'Đang chờ trình duyệt...'
                  : isEn
                    ? 'Open Google OAuth'
                    : 'Mở trang cấp quyền Google'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VAULT SETTINGS */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {isEn ? 'Vault Settings & Import' : 'Cài đặt kho & Nhập dữ liệu'}
              </h3>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {/* Auto-lock */}
            <div className="space-y-3 rounded-lg border border-border p-3.5 text-xs">
              <h4 className="font-semibold">{isEn ? 'Auto-Lock' : 'Tự động khóa kho'}</h4>
              <div className="flex items-center justify-between gap-3">
                <span>{isEn ? 'Lock after inactivity (minutes, 0 = off)' : 'Khóa sau khi không thao tác (phút, 0 = tắt)'}</span>
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={autoLockMinutes}
                  onChange={(e) => setAutoLockMinutes(Number(e.target.value) || 0)}
                  className="w-24"
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lockOnMinimize}
                  onChange={(e) => setLockOnMinimize(e.target.checked)}
                />
                <span>{isEn ? 'Lock when app window minimizes' : 'Tự động khóa khi thu nhỏ cửa sổ'}</span>
              </label>
              <Button size="sm" onClick={() => void handleSaveVaultSettings()}>
                {isEn ? 'Save Auto-Lock Settings' : 'Lưu cài đặt tự khóa'}
              </Button>
            </div>

            {/* Google credentials.json */}
            <div className="space-y-2 rounded-lg border border-border p-3.5 text-xs">
              <h4 className="font-semibold">Google OAuth credentials.json</h4>
              <p className="text-muted-foreground">
                {status.hasGoogleCredentials
                  ? isEn
                    ? 'credentials.json is stored encrypted inside vault.db.'
                    : 'File credentials.json đã được mã hóa và lưu an toàn trong vault.db.'
                  : isEn
                    ? 'Import your Desktop App OAuth credentials.json from Google Cloud Console (see docs/GMAIL_SETUP.md).'
                    : 'Nhập file OAuth Desktop App credentials.json từ Google Cloud Console (xem docs/GMAIL_SETUP.md).'}
              </p>
              <Button size="sm" variant="outline" onClick={() => void handleImportGoogleCreds()} className="gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                <span>{isEn ? 'Import credentials.json' : 'Nhập credentials.json'}</span>
              </Button>
            </div>

            {/* Change master password */}
            <form onSubmit={(e) => void handleChangeMasterPw(e)} className="space-y-2 rounded-lg border border-border p-3.5 text-xs">
              <h4 className="font-semibold">{isEn ? 'Change Master Password' : 'Đổi mật khẩu chính'}</h4>
              <Input
                type="password"
                value={oldMasterPw}
                onChange={(e) => setOldMasterPw(e.target.value)}
                placeholder={isEn ? 'Current master password' : 'Mật khẩu chính hiện tại'}
                required
              />
              <Input
                type="password"
                value={newMasterPw}
                onChange={(e) => setNewMasterPw(e.target.value)}
                placeholder={isEn ? 'New master password (min 6 chars)' : 'Mật khẩu chính mới (tối thiểu 6 ký tự)'}
                required
              />
              <Button size="sm" type="submit">
                {isEn ? 'Update Master Password' : 'Đổi mật khẩu chính'}
              </Button>
            </form>

            {/* Import legacy Python vault.db */}
            <div className="space-y-2 rounded-lg border border-border p-3.5 text-xs">
              <h4 className="font-semibold">
                {isEn ? 'Import Legacy Python Vault (vault.db)' : 'Nhập từ kho Python cũ (vault.db)'}
              </h4>
              <Input
                type="password"
                value={legacyPw}
                onChange={(e) => setLegacyPw(e.target.value)}
                placeholder={isEn ? 'Legacy vault master password' : 'Mật khẩu chính của vault.db cũ'}
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={legacyMode === 'skip'}
                    onChange={() => setLegacyMode('skip')}
                  />
                  <span>{isEn ? 'Skip duplicates' : 'Bỏ qua email trùng'}</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={legacyMode === 'overwrite'}
                    onChange={() => setLegacyMode('overwrite')}
                  />
                  <span>{isEn ? 'Overwrite duplicates' : 'Ghi đè email trùng'}</span>
                </label>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={legacyBusy}
                onClick={() => void handleImportLegacy()}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{isEn ? 'Choose Legacy vault.db & Import' : 'Chọn file vault.db cũ & Nhập'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
