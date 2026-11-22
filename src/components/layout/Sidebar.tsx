import type { ComponentType } from 'react';
import { Folder, Globe, LayoutGrid, Plus, Settings, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/i18n';
import { useAppStore, type NavPageId } from '@/store/useAppStore';

interface NavItem {
  id: Exclude<NavPageId, 'new-profile'>;
  labelKey: 'allProfiles' | 'folders' | 'proxies' | 'settings';
  icon: ComponentType<{ className?: string }>;
}

const profileNavItems: NavItem[] = [
  { id: 'profiles', labelKey: 'allProfiles', icon: LayoutGrid },
  { id: 'folders', labelKey: 'folders', icon: Folder },
];

const systemNavItems: NavItem[] = [
  { id: 'proxies', labelKey: 'proxies', icon: Globe },
  { id: 'settings', labelKey: 'settings', icon: Settings },
];

export function Sidebar(): React.JSX.Element {
  const { activePage, setActivePage, openNewProfile, appInfo, locale, profiles, runningIds } =
    useAppStore();
  const dict = getTranslations(locale);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Shield className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              {dict.app.name}
            </span>
            <span className="text-[11px] text-muted-foreground">{dict.app.localMode}</span>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          v{appInfo?.version ?? '0.1.0'}
        </Badge>
      </div>

      <div className="px-3 pb-3 pt-1">
        <Button
          onClick={openNewProfile}
          variant={activePage === 'new-profile' ? 'default' : 'secondary'}
          className={cn(
            'w-full justify-center gap-2 font-medium',
            activePage !== 'new-profile' &&
              'border border-border bg-card text-foreground hover:bg-accent',
          )}
        >
          <Plus className="h-4 w-4" />
          <span>{dict.nav.newProfile}</span>
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <div>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80">
            {dict.nav.sectionProfiles}
          </p>
          <div className="space-y-1">
            {profileNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePage(item.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{dict.nav[item.labelKey]}</span>
                  </span>
                  {item.id === 'profiles' && (
                    <span className="text-xs text-muted-foreground">{profiles.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80">
            {dict.nav.sectionNetwork}
          </p>
          <div className="space-y-1">
            {systemNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePage(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{dict.nav[item.labelKey]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="space-y-1.5 rounded-lg border border-border bg-card/70 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {dict.status.ready}
            </span>
            <span className="text-muted-foreground">
              {runningIds.length} {dict.common.running.toLowerCase()}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {appInfo
              ? `${dict.status.electron} ${appInfo.electronVersion}`
              : dict.status.webPreview}
          </div>
        </div>
      </div>
    </aside>
  );
}
