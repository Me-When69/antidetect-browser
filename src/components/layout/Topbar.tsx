import { Moon, Search, Sun } from 'lucide-react';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps): React.JSX.Element {
  const {
    locale,
    setLocale,
    theme,
    setTheme,
    filter,
    setFilter,
    setActivePage,
    setCommandPaletteOpen,
  } = useAppStore();
  const dict = getTranslations(locale);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar/70 px-6">
      <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>

      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-72 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-xs text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            type="text"
            value={filter.search ?? ''}
            onChange={(e) => {
              setFilter({ search: e.target.value });
              setActivePage('profiles');
            }}
            placeholder={dict.topbar.searchPlaceholder}
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground hover:text-foreground"
            title="Open Command Palette (Ctrl+K)"
          >
            {dict.topbar.shortcut}
          </button>
        </div>

        <button
          type="button"
          onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
          title={theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={() => void setLocale(locale === 'vi' ? 'en' : 'vi')}
          className="h-8 rounded-md border border-border bg-card px-2.5 font-mono text-xs font-medium text-foreground hover:bg-accent"
          title="Switch language VI / EN"
        >
          {locale.toUpperCase()}
        </button>
      </div>
    </header>
  );
}
