import fs from 'node:fs';
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { LaunchOptions } from '@shared/types';
import { generateStrongPassword } from './crypto';
import type { VaultService } from './vaultService';
import type { ClipboardGuard } from './clipboardGuard';
import { generateTotpCode } from './totpService';
import { auditVaultAccounts } from './securityAudit';
import { importFromLegacyPythonVault } from './legacyImport';
import type { GmailOAuthService } from '../gmail/oauthService';
import type { GmailService } from '../gmail/gmailService';
import { extractEncryptedEmlArchiveToDir } from '../gmail/emlArchive';
import type { ProfileService } from '../profileService';
import type { ProfileLauncher } from '../launcher';
import type { AppLogger } from '../logger';

const emailSchema = z.string().trim().email('Địa chỉ email không hợp lệ').max(320);
const nonEmptyString = z.string().min(1).max(1024);

const addAccountSchema = z.object({
  email: emailSchema,
  label: z.string().max(120).optional(),
  password: z.string().max(512).optional(),
  recovery: z.string().max(320).optional(),
  totp: z.string().max(512).optional(),
  notes: z.string().max(4000).optional(),
  allowModify: z.boolean().optional(),
});

const updateAccountSchema = z.object({
  email: emailSchema,
  label: z.string().max(120).optional(),
  password: z.string().max(512).optional(),
  recovery: z.string().max(320).optional(),
  totp: z.string().max(512).optional(),
  notes: z.string().max(4000).optional(),
  allowModify: z.boolean().optional(),
});

const vaultSettingsSchema = z.object({
  autoLockMinutes: z.number().int().min(0).max(240).optional(),
  lockOnMinimize: z.boolean().optional(),
});

const searchMessagesSchema = z.object({
  emails: z.array(emailSchema).min(1).max(50),
  query: z.string().max(500),
  maxPerAccount: z.number().int().min(1).max(100).optional(),
});

const batchModifySchema = z.object({
  email: emailSchema,
  ids: z.array(z.string().min(1).max(128)).min(1).max(500),
  addLabelIds: z.array(z.string().min(1).max(64)).max(20),
  removeLabelIds: z.array(z.string().min(1).max(64)).max(20),
});

const backupOptionsSchema = z.object({
  email: emailSchema,
  maxMessages: z.number().int().min(1).max(5000),
  targetDir: z.string().min(1).max(1024),
  encryptZip: z.boolean(),
  zipPassword: z.string().max(256).optional(),
});

export interface VaultIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  vaultService: VaultService;
  clipboardGuard: ClipboardGuard;
  oauthService: GmailOAuthService;
  gmailService: GmailService;
  profileService: ProfileService;
  profileLauncher: ProfileLauncher;
  logger: AppLogger;
}

export function registerVaultAndGmailIpc(deps: VaultIpcDeps): void {
  const {
    getMainWindow,
    vaultService,
    clipboardGuard,
    oauthService,
    gmailService,
    profileService,
    profileLauncher,
    logger,
  } = deps;

  let activeSearchAbort: AbortController | null = null;
  let activeBackupAbort: AbortController | null = null;

  function assertTrustedSender(event: IpcMainInvokeEvent): void {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) {
      throw new Error('Yêu cầu IPC không hợp lệ (nguồn gửi không đáng tin cậy)');
    }
  }

  function handle<TArgs extends unknown[], TResult>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
  ): void {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event);
      return await fn(event, ...(args as TArgs));
    });
  }

  // ---- Vault lifecycle & settings ----
  handle(IPC_CHANNELS.VAULT_STATUS, () => vaultService.getStatus());

  handle(IPC_CHANNELS.VAULT_UNLOCK, (_e, masterPassword: unknown) => {
    const pw = nonEmptyString.parse(masterPassword);
    vaultService.unlock(pw);
    logger.info('vault', 'Vault unlocked');
    return vaultService.getStatus();
  });

  handle(IPC_CHANNELS.VAULT_LOCK, () => {
    vaultService.lock();
    logger.info('vault', 'Vault locked');
    return vaultService.getStatus();
  });

  handle(
    IPC_CHANNELS.VAULT_CHANGE_MASTER_PASSWORD,
    (_e, oldPassword: unknown, newPassword: unknown) => {
      const oldPw = nonEmptyString.parse(oldPassword);
      const newPw = z.string().min(6).max(512).parse(newPassword);
      vaultService.changeMasterPassword(oldPw, newPw);
      logger.info('vault', 'Master password changed');
    },
  );

  handle(IPC_CHANNELS.VAULT_SET_SETTINGS, (_e, rawSettings: unknown) => {
    const parsed = vaultSettingsSchema.parse(rawSettings);
    if (parsed.autoLockMinutes !== undefined) {
      vaultService.setAutoLockMinutes(parsed.autoLockMinutes);
    }
    if (parsed.lockOnMinimize !== undefined) {
      vaultService.setLockOnMinimize(parsed.lockOnMinimize);
    }
    return vaultService.getStatus();
  });

  // ---- Accounts CRUD (masked summaries ONLY) ----
  handle(IPC_CHANNELS.VAULT_LIST_ACCOUNTS, () => vaultService.listAccounts());

  handle(IPC_CHANNELS.VAULT_ADD_ACCOUNT, (_e, input: unknown) => {
    const parsed = addAccountSchema.parse(input);
    const created = vaultService.addAccount(parsed);
    logger.info('vault', `Added account ${created.email}`);
    return created;
  });

  handle(IPC_CHANNELS.VAULT_UPDATE_ACCOUNT, (_e, input: unknown) => {
    const parsed = updateAccountSchema.parse(input);
    const updated = vaultService.updateAccount(parsed);
    logger.info('vault', `Updated account ${updated.email}`);
    return updated;
  });

  handle(IPC_CHANNELS.VAULT_DELETE_ACCOUNT, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    const deleted = vaultService.deleteAccount(email);
    profileService.unlinkAccountEverywhere(email);
    logger.info('vault', `Deleted account ${email}`);
    return deleted;
  });

  handle(IPC_CHANNELS.VAULT_MARK_PASSWORD_CHANGED, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    return vaultService.markPasswordChanged(email);
  });

  handle(IPC_CHANNELS.VAULT_GENERATE_PASSWORD, (_e, rawLen?: unknown) => {
    const len = rawLen === undefined ? 20 : z.number().int().min(12).max(64).parse(rawLen);
    return generateStrongPassword(len);
  });

  // ---- Secret actions in main process (never expose raw secrets by default) ----
  handle(IPC_CHANNELS.VAULT_COPY_PASSWORD, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    const password = vaultService.getAccountSecret(email, 'password');
    if (!password) {
      throw new Error('Tài khoản này chưa lưu mật khẩu');
    }
    clipboardGuard.copySensitive(password, 20_000);
    return { clearAfterSec: 20 };
  });

  handle(
    IPC_CHANNELS.VAULT_REVEAL_PASSWORD_TEMP,
    (_e, rawEmail: unknown, rawMasterPassword: unknown) => {
      const email = emailSchema.parse(rawEmail);
      const masterPw = nonEmptyString.parse(rawMasterPassword);
      if (!vaultService.verifyMasterPassword(masterPw)) {
        throw new Error('Sai mật khẩu chính (master password)');
      }
      const password = vaultService.getAccountSecret(email, 'password');
      return { password, ttlSeconds: 10 };
    },
  );

  handle(IPC_CHANNELS.VAULT_GET_ACCOUNT_NON_CRED_DETAILS, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    return {
      recovery: vaultService.getAccountSecret(email, 'recovery'),
      notes: vaultService.getAccountSecret(email, 'notes'),
    };
  });

  handle(IPC_CHANNELS.VAULT_GET_TOTP_CODE, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    const secret = vaultService.getAccountSecret(email, 'totp');
    if (!secret) {
      throw new Error('Tài khoản này chưa cấu hình 2FA TOTP');
    }
    return generateTotpCode(secret);
  });

  handle(IPC_CHANNELS.VAULT_COPY_TOTP, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    const secret = vaultService.getAccountSecret(email, 'totp');
    if (!secret) {
      throw new Error('Tài khoản này chưa cấu hình 2FA TOTP');
    }
    const result = generateTotpCode(secret);
    clipboardGuard.copySensitive(result.code, 20_000);
    return {
      ...result,
      clearAfterSec: 20,
    };
  });

  handle(IPC_CHANNELS.VAULT_AUDIT_SECURITY, () => auditVaultAccounts(vaultService));

  handle(IPC_CHANNELS.VAULT_IMPORT_GOOGLE_CREDENTIALS, async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Chọn file Google OAuth credentials.json',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }
    const filePath = res.filePaths[0]!;
    const raw = fs.readFileSync(filePath, 'utf8');
    vaultService.setGoogleCredentials(raw);
    logger.info('vault', 'Imported Google OAuth credentials.json into encrypted vault');
    return { ok: true };
  });

  handle(
    IPC_CHANNELS.VAULT_IMPORT_LEGACY_DB,
    async (_e, rawLegacyPassword: unknown, rawMode: unknown) => {
      const legacyPw = nonEmptyString.parse(rawLegacyPassword);
      const mode = z.enum(['skip', 'overwrite']).parse(rawMode);
      const win = getMainWindow();
      const res = await dialog.showOpenDialog(win ?? undefined!, {
        title: 'Chọn file vault.db cũ (Python/Fernet)',
        properties: ['openFile'],
        filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
      });
      if (res.canceled || res.filePaths.length === 0) {
        return {
          imported: 0,
          overwritten: 0,
          skipped: 0,
          tokensImported: 0,
          errors: [],
          cancelled: true,
        };
      }
      const legacyPath = res.filePaths[0]!;
      const result = importFromLegacyPythonVault(vaultService, {
        legacyDbPath: legacyPath,
        legacyMasterPassword: legacyPw,
        overwriteDuplicates: mode === 'overwrite',
      });
      logger.info(
        'vault',
        `Legacy vault import completed: imported=${result.imported}, overwritten=${result.overwritten}, skipped=${result.skipped}`,
      );
      return result;
    },
  );

  // ---- Gmail API ----
  handle(IPC_CHANNELS.GMAIL_AUTHORIZE, async (_e, rawEmail: unknown, rawAllowModify: unknown) => {
    const email = emailSchema.parse(rawEmail);
    const allowModify = z.boolean().parse(rawAllowModify);
    vaultService.updateAccount({ email, allowModify });
    const result = await oauthService.authorizeAccount(email, allowModify);
    logger.info('gmail', `Authorized Gmail API for ${email} (scope=${result.scope})`);
    return result;
  });

  handle(IPC_CHANNELS.GMAIL_REVOKE, async (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    const result = await oauthService.revokeAccount(email);
    logger.info('gmail', `Revoked Gmail API for ${email} (remote=${result.remoteRevoked})`);
    return result;
  });

  handle(
    IPC_CHANNELS.GMAIL_SEARCH_MESSAGES,
    async (_e, rawEmails: unknown, rawQuery: unknown, rawMax?: unknown) => {
      const parsed = searchMessagesSchema.parse({
        emails: rawEmails,
        query: rawQuery,
        maxPerAccount: rawMax,
      });
      activeSearchAbort?.abort();
      const controller = new AbortController();
      activeSearchAbort = controller;
      try {
        return await gmailService.searchMessages(
          parsed.emails,
          parsed.query,
          parsed.maxPerAccount ?? 25,
          controller.signal,
        );
      } finally {
        if (activeSearchAbort === controller) {
          activeSearchAbort = null;
        }
      }
    },
  );

  handle(IPC_CHANNELS.GMAIL_CANCEL_SEARCH, () => {
    activeSearchAbort?.abort();
    activeSearchAbort = null;
  });

  handle(
    IPC_CHANNELS.GMAIL_BATCH_MODIFY,
    async (
      _e,
      rawEmail: unknown,
      rawIds: unknown,
      rawAddLabels: unknown,
      rawRemoveLabels: unknown,
    ) => {
      const parsed = batchModifySchema.parse({
        email: rawEmail,
        ids: rawIds,
        addLabelIds: rawAddLabels,
        removeLabelIds: rawRemoveLabels,
      });
      return await gmailService.batchModifyMessages(
        parsed.email,
        parsed.ids,
        parsed.addLabelIds,
        parsed.removeLabelIds,
      );
    },
  );

  handle(IPC_CHANNELS.GMAIL_SELECT_BACKUP_DIR, async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Chọn thư mục lưu bản sao lưu Gmail',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0]!;
  });

  handle(IPC_CHANNELS.GMAIL_BACKUP_EMAILS, async (_e, rawOptions: unknown) => {
    const options = backupOptionsSchema.parse(rawOptions);
    activeBackupAbort?.abort();
    const controller = new AbortController();
    activeBackupAbort = controller;
    try {
      return await gmailService.backupEmails(
        options,
        (progress) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.GMAIL_BACKUP_PROGRESS, progress);
          }
        },
        controller.signal,
      );
    } finally {
      if (activeBackupAbort === controller) {
        activeBackupAbort = null;
      }
    }
  });

  handle(IPC_CHANNELS.GMAIL_CANCEL_BACKUP, () => {
    activeBackupAbort?.abort();
    activeBackupAbort = null;
  });

  handle(IPC_CHANNELS.GMAIL_SELECT_ARCHIVE_FILE, async () => {
    const win = getMainWindow();
    const dialogOpts: Electron.OpenDialogOptions = {
      title: 'Chọn tệp sao lưu thư (.facet-eml)',
      properties: ['openFile'],
      filters: [
        { name: 'Facet Encrypted Email Archive', extensions: ['facet-eml', 'zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    };
    const res = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0]!;
  });

  handle(
    IPC_CHANNELS.GMAIL_EXTRACT_ARCHIVE,
    (_e, rawArchivePath: unknown, rawOutputDir: unknown, rawPassword: unknown) => {
      const archivePath = nonEmptyString.parse(rawArchivePath);
      const outputDir = nonEmptyString.parse(rawOutputDir);
      const password = z.string().min(1).max(256).parse(rawPassword);
      return extractEncryptedEmlArchiveToDir(archivePath, outputDir, password);
    },
  );

  // ---- Profile <-> Account Links & Open Gmail in Profile ----
  handle(IPC_CHANNELS.PROFILE_ACCOUNTS_LINK, (_e, rawProfileId: unknown, rawEmail: unknown) => {
    const profileId = nonEmptyString.parse(rawProfileId);
    const email = emailSchema.parse(rawEmail);
    profileService.linkAccount(profileId, email);
  });

  handle(IPC_CHANNELS.PROFILE_ACCOUNTS_UNLINK, (_e, rawProfileId: unknown, rawEmail: unknown) => {
    const profileId = nonEmptyString.parse(rawProfileId);
    const email = emailSchema.parse(rawEmail);
    profileService.unlinkAccount(profileId, email);
  });

  handle(IPC_CHANNELS.PROFILE_ACCOUNTS_LIST_FOR_PROFILE, (_e, rawProfileId: unknown) => {
    const profileId = nonEmptyString.parse(rawProfileId);
    return profileService.listLinkedAccounts(profileId);
  });

  handle(IPC_CHANNELS.PROFILE_ACCOUNTS_LIST_ALL, () => profileService.listAllProfileAccountLinks());

  handle(IPC_CHANNELS.PROFILE_ACCOUNTS_LIST_PROFILES_FOR_EMAIL, (_e, rawEmail: unknown) => {
    const email = emailSchema.parse(rawEmail);
    return profileService.listProfilesForAccount(email);
  });

  handle(
    IPC_CHANNELS.LAUNCHER_OPEN_GMAIL_IN_PROFILE,
    async (_e, rawProfileId: unknown, rawOptions?: unknown) => {
      const profileId = nonEmptyString.parse(rawProfileId);
      const opts = (rawOptions ?? undefined) as (LaunchOptions & { url?: string }) | undefined;
      return await profileLauncher.openGmailInProfile(profileId, opts);
    },
  );
}
