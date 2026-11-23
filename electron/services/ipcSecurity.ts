import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';

export const ipcIdSchema = z.string().trim().min(1).max(128);
export const ipcIdListSchema = z.array(ipcIdSchema).max(500);
export const ipcShortStringSchema = z.string().trim().min(1).max(256);
export const ipcPlatformSchema = z.enum(['windows', 'macos', 'linux', 'android', 'ios']);
export const ipcBrowserSchema = z.enum(['chrome', 'firefox', 'webkit']);
export const ipcInstallBrowserSchema = z.enum(['chromium', 'firefox']);
export const ipcProxyCoreSchema = z.enum(['sing-box', 'xray']);
export const ipcCookieFormatSchema = z.enum(['json', 'netscape']);
export const ipcVersionSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{2,4}(\.[0-9]{1,5}){0,3}$/, 'Phiên bản trình duyệt không hợp lệ');

export function assertTrustedIpcSender(
  sender: unknown,
  win: Pick<BrowserWindow, 'isDestroyed' | 'webContents'> | null,
): void {
  if (!win || win.isDestroyed() || sender !== win.webContents) {
    throw new Error('Yêu cầu IPC không hợp lệ (nguồn gửi không đáng tin cậy)');
  }
}

export type SafeIpcHandle = <TArgs extends unknown[], TResult>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
) => void;

export function createSafeIpcRegistrar(
  ipcMainRef: Pick<IpcMain, 'handle'>,
  getMainWindow: () => BrowserWindow | null,
): SafeIpcHandle {
  return <TArgs extends unknown[], TResult>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
  ) => {
    ipcMainRef.handle(channel, async (event, ...args) => {
      assertTrustedIpcSender(event.sender, getMainWindow());
      return await fn(event, ...(args as TArgs));
    });
  };
}
