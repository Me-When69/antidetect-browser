import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Ipv6PoolService } from './ipv6PoolService';

const configPatchSchema = z.object({
  interfaceName: z.string().max(128).optional(),
  prefix64: z.string().max(128).optional(),
  ownershipConfirmed: z.boolean().optional(),
  maxAddresses: z.number().int().min(1).max(1024).optional(),
  maxConcurrentPerListener: z.number().int().min(1).max(2000).optional(),
  echoEndpoints: z.array(z.string().url().max(256)).min(1).max(10).optional(),
  autoRotateEnabled: z.boolean().optional(),
  autoRotateIntervalMinutes: z.number().int().min(10).max(1440).optional(),
});

const allocateSchema = z.number().int().min(1).max(1024);
const nonEmptyId = z.string().trim().min(1).max(128);
const ipv6String = z.string().trim().min(2).max(128);

export interface Ipv6PoolIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  ipv6PoolService: Ipv6PoolService;
}

export function registerIpv6PoolIpc(deps: Ipv6PoolIpcDeps): void {
  const { getMainWindow, ipv6PoolService } = deps;

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

  handle(IPC_CHANNELS.IPV6_POOL_LIST_INTERFACES, () => ipv6PoolService.listInterfaces());

  handle(IPC_CHANNELS.IPV6_POOL_GET_STATUS, () => ipv6PoolService.getStatus());

  handle(IPC_CHANNELS.IPV6_POOL_UPDATE_CONFIG, (_e, rawPatch: unknown) => {
    const patch = configPatchSchema.parse(rawPatch);
    return ipv6PoolService.updateConfig(patch);
  });

  handle(IPC_CHANNELS.IPV6_POOL_VERIFY_ROUTING, () => ipv6PoolService.verifyRouting());

  handle(IPC_CHANNELS.IPV6_POOL_ALLOCATE, (_e, rawCount: unknown) => {
    const count = allocateSchema.parse(rawCount);
    return ipv6PoolService.allocatePoolAddresses(count);
  });

  handle(IPC_CHANNELS.IPV6_POOL_ROTATE_PROFILE, (_e, rawProfileId: unknown, rawForce?: unknown) => {
    const profileId = nonEmptyId.parse(rawProfileId);
    const forceIfRunning = z.boolean().optional().parse(rawForce) ?? false;
    return ipv6PoolService.rotateProfileAddress(profileId, { forceIfRunning });
  });

  handle(IPC_CHANNELS.IPV6_POOL_ROTATE_ALL, (_e, rawForce?: unknown) => {
    const forceIfRunning = z.boolean().optional().parse(rawForce) ?? false;
    return ipv6PoolService.rotateAllAddresses(forceIfRunning);
  });

  handle(IPC_CHANNELS.IPV6_POOL_REMOVE_ADDRESS, (_e, rawAddr: unknown) => {
    const addr = ipv6String.parse(rawAddr);
    return ipv6PoolService.removeAddress(addr);
  });

  handle(IPC_CHANNELS.IPV6_POOL_REMOVE_ALL, () => ipv6PoolService.removeAllAppAddresses());

  handle(IPC_CHANNELS.IPV6_POOL_CHECK_HEALTH_ALL, () => ipv6PoolService.checkHealthAll(5));

  handle(IPC_CHANNELS.IPV6_POOL_DETECT_ORPHANS, () => ipv6PoolService.detectOrphansOnStartup());
}
