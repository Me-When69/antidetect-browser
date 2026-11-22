import { Search } from 'lucide-react';
import { t } from '@/i18n';

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps): React.JSX.Element {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar/60 px-6">
      <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>

      <div className="flex items-center gap-3">
        <div className="flex h-8 w-64 items-center justify-between rounded-md border border-input bg-card px-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-2 truncate">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t.topbar.searchPlaceholder}</span>
          </span>
          <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t.topbar.shortcut}
          </kbd>
        </div>
        <span className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground">
          VI
        </span>
      </div>
    </header>
  );
}
