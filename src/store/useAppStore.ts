import { create } from 'zustand';
import type { AppInfo } from '@shared/ipc';
import type {
  AppSettings,
  Folder,
  LocaleCode,
  LocalApiStatus,
  Profile,
  ProfileFilter,
  SavedProxy,
  Tag,
  ThemeMode,
} from '@shared/types';

export type NavPageId = 'profiles' | 'folders' | 'proxies' | 'trash' | 'settings' | 'new-profile';

interface ToastMessage {
  id: number;
  type: 'info' | 'success' | 'error';
  text: string;
}

interface AppState {
  activePage: NavPageId;
  editingProfileId: string | null;
  commandPaletteOpen: boolean;
  appInfo: AppInfo | null;
  settings: AppSettings;
  apiStatus: LocalApiStatus | null;
  locale: LocaleCode;
  theme: ThemeMode;

  profiles: Profile[];
  trashProfiles: Profile[];
  folders: Folder[];
  tags: Tag[];
  proxies: SavedProxy[];
  runningIds: string[];
  selectedIds: string[];
  filter: ProfileFilter;
  loading: boolean;
  toast: ToastMessage | null;

  setActivePage: (page: NavPageId) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  openNewProfile: () => void;
  openEditProfile: (id: string) => void;
  setFilter: (patch: Partial<ProfileFilter>) => void;
  toggleSelectProfile: (id: string) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  setRunningStatus: (profileId: string, running: boolean) => void;
  showToast: (text: string, type?: ToastMessage['type']) => void;
  clearToast: () => void;

  bootstrap: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  refreshTrash: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshProxies: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setLocale: (locale: LocaleCode) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  locale: 'vi',
  theme: 'dark',
  chromePath: '',
  camoufoxPath: '',
  localApiEnabled: true,
  localApiPort: 36912,
  localApiKey: '',
};

let toastCounter = 1;

export const useAppStore = create<AppState>((set, get) => ({
  activePage: 'profiles',
  editingProfileId: null,
  commandPaletteOpen: false,
  appInfo: null,
  settings: DEFAULT_SETTINGS,
  apiStatus: null,
  locale: 'vi',
  theme: 'dark',

  profiles: [],
  trashProfiles: [],
  folders: [],
  tags: [],
  proxies: [],
  runningIds: [],
  selectedIds: [],
  filter: {
    search: '',
    folderId: null,
    tag: '',
    status: 'all',
    sortBy: 'createdAt',
    sortDir: 'desc',
  },
  loading: false,
  toast: null,

  setActivePage: (page) => set({ activePage: page }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  openNewProfile: () => set({ activePage: 'new-profile', editingProfileId: null }),
  openEditProfile: (id) => set({ activePage: 'new-profile', editingProfileId: id }),

  setFilter: (patch) => {
    set((state) => ({ filter: { ...state.filter, ...patch } }));
    void get().refreshProfiles();
  },

  toggleSelectProfile: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id],
    })),

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),

  setRunningStatus: (profileId, running) =>
    set((state) => {
      const exists = state.runningIds.includes(profileId);
      if (running && !exists) {
        return { runningIds: [...state.runningIds, profileId] };
      }
      if (!running && exists) {
        return { runningIds: state.runningIds.filter((id) => id !== profileId) };
      }
      return state;
    }),

  showToast: (text, type = 'info') => {
    const id = toastCounter++;
    set({ toast: { id, type, text } });
    setTimeout(() => {
      if (get().toast?.id === id) {
        set({ toast: null });
      }
    }, 4000);
  },

  clearToast: () => set({ toast: null }),

  bootstrap: async () => {
    const api = window.electronAPI;
    if (!api) return;
    set({ loading: true });
    try {
      const [
        appInfo,
        settings,
        apiStatus,
        folders,
        tags,
        proxies,
        runningIds,
        profiles,
        trashProfiles,
      ] = await Promise.all([
        api.getAppInfo(),
        api.getSettings(),
        api.getLocalApiStatus(),
        api.listFolders(),
        api.listTags(),
        api.listProxies(),
        api.getRunningProfileIds(),
        api.listProfiles(get().filter),
        api.listTrashProfiles(),
      ]);
      set({
        appInfo,
        settings,
        locale: settings.locale,
        theme: settings.theme,
        apiStatus,
        folders,
        tags,
        proxies,
        runningIds,
        profiles,
        trashProfiles,
      });
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : 'Lỗi tải dữ liệu', 'error');
    } finally {
      set({ loading: false });
    }
  },

  refreshProfiles: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const profiles = await api.listProfiles(get().filter);
    set({ profiles });
  },

  refreshTrash: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const trashProfiles = await api.listTrashProfiles();
    set({ trashProfiles });
  },

  refreshFolders: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const folders = await api.listFolders();
    set({ folders });
  },

  refreshTags: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const tags = await api.listTags();
    set({ tags });
  },

  refreshProxies: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const proxies = await api.listProxies();
    set({ proxies });
  },

  refreshSettings: async () => {
    const api = window.electronAPI;
    if (!api) return;
    const [settings, apiStatus] = await Promise.all([api.getSettings(), api.getLocalApiStatus()]);
    set({ settings, locale: settings.locale, theme: settings.theme, apiStatus });
  },

  setLocale: async (locale) => {
    set({ locale });
    const api = window.electronAPI;
    if (api) {
      const settings = await api.updateSettings({ locale });
      set({ settings });
    }
  },

  setTheme: async (theme) => {
    set({ theme });
    const api = window.electronAPI;
    if (api) {
      const settings = await api.updateSettings({ theme });
      set({ settings });
    }
  },
}));
