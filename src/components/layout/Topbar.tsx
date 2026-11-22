import { Search } from 'lucide-react';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps): React.JSX.Element {
  const { locale, setLocale, filter, setFilter, setActivePage } = useAppStore();
  const dict = getTranslations(locale);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar/60 px-6">
      <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>

      <div className="flex items-center gap-3">
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
          <kbd className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {dict.topbar.shortcut}
          </kbd>
        </div>

        <button
          type="button"
          onClick={() => void setLocale(locale === 'vi' ? 'en' : 'vi')}
          className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
          title="Switch language VI / EN"
        >
          {locale.toUpperCase()}
        </button>
      </div>
    </header>
  );
}
