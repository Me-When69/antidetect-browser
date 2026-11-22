import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppInfo, type ElectronApi } from '@shared/ipc';

const electronApi: ElectronApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
};

contextBridge.exposeInMainWorld('electronAPI', electronApi);
