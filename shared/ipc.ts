export const IPC_CHANNELS = {
  APP_GET_INFO: 'app:getInfo',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  electronVersion: string;
}

export interface ElectronApi {
  getAppInfo: () => Promise<AppInfo>;
}
