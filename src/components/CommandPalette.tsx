import { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  LayoutGrid,
  Moon,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  Sun,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: typeof Play;
  action: () => void | Promise<void>;
}

export function CommandPalette(): React.JSX.Element | null {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    profiles,
    runningIds,
    theme,
    setTheme,
    locale,
    setLocale,
    openNewProfile,
    setActivePage,
    refreshProfiles,
    showToast,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [commandPaletteOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const isEn = locale === 'en';
    const baseActions: PaletteItem[] = [
      {
        id: 'act-new',
        label: isEn ? 'Create New Profile' : 'Tạo hồ sơ mới',
        hint: isEn ? 'Action' : 'Thao tác',
        icon: Plus,
        action: () => openNewProfile(),
      },
      {
        id: 'act-profiles',
        label: isEn ? 'Go to All Profiles' : 'Đi tới Tất cả hồ sơ',
        hint: isEn ? 'Navigation' : 'Điều hướng',
        icon: LayoutGrid,
        action: () => setActivePage('profiles'),
      },
      {
        id: 'act-proxies',
        label: isEn ? 'Go to Proxy Vault' : 'Đi tới Kho Proxy',
        hint: isEn ? 'Navigation' : 'Điều hướng',
        icon: Globe,
        action: () => setActivePage('proxies'),
      },
      {
        id: 'act-trash',
        label: isEn ? 'Open Trash' : 'Mở Thùng rác',
        hint: isEn ? 'Navigation' : 'Điều hướng',
        icon: Trash2,
        action: () => setActivePage('trash'),
      },
      {
        id: 'act-settings',
        label: isEn ? 'Open Settings' : 'Mở Cài đặt',
        hint: isEn ? 'Navigation' : 'Điều hướng',
        icon: Settings,
        action: () => setActivePage('settings'),
      },
      {
        id: 'act-theme',
        label:
          theme === 'dark'
            ? isEn
              ? 'Switch to Light Theme'
              : 'Chuyển sang Giao diện Sáng'
            : isEn
              ? 'Switch to Dark Theme'
              : 'Chuyển sang Giao diện Tối',
        hint: 'Theme',
        icon: theme === 'dark' ? Sun : Moon,
        action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'act-lang',
        label: isEn ? 'Switch language to Tiếng Việt' : 'Đổi ngôn ngữ sang English',
        hint: 'i18n',
        icon: Globe,
        action: () => setLocale(isEn ? 'vi' : 'en'),
      },
    ];

    const profileItems: PaletteItem[] = profiles.map((p) => {
      const isRunning = runningIds.includes(p.id);
      return {
        id: `prof-${p.id}`,
        label: `${isRunning ? (isEn ? 'Stop' : 'Dừng') : isEn ? 'Start' : 'Chạy'}: ${p.name}`,
        hint: `${p.platform.toUpperCase()} • ${p.browser}`,
        icon: isRunning ? Square : Play,
        action: async () => {
          if (!window.electronAPI) return;
          try {
            if (isRunning) {
              await window.electronAPI.stopProfile(p.id);
            } else {
              await window.electronAPI.startProfile(p.id);
              await refreshProfiles();
            }
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Error', 'error');
          }
        },
      };
    });

    const all = [...profileItems, ...baseActions];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 12);
    return all
      .filter((item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q))
      .slice(0, 12);
  }, [
    locale,
    profiles,
    runningIds,
    theme,
    query,
    openNewProfile,
    setActivePage,
    setTheme,
    setLocale,
    refreshProfiles,
    showToast,
  ]);

  if (!commandPaletteOpen) return null;

  const execute = (item: PaletteItem | undefined): void => {
    if (!item) return;
    setCommandPaletteOpen(false);
    void item.action();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24 backdrop-blur-[1px]"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCommandPaletteOpen(false);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                execute(items[selectedIndex]);
              }
            }}
            placeholder={
              locale === 'en'
                ? 'Type a command or profile name...'
                : 'Gõ tên hồ sơ hoặc lệnh nhanh...'
            }
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {locale === 'en' ? 'No matching results' : 'Không tìm thấy kết quả phù hợp'}
            </p>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => execute(item)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-accent',
                  )}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {item.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
