import type { ComponentType } from 'react';
import { Folder, Globe, LayoutGrid, Plus, Settings, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { AppInfo } from '@shared/ipc';

export type NavPageId = 'profiles' | 'folders' | 'proxies' | 'settings' | 'new-profile';

interface NavItem {
  id: Exclude<NavPageId, 'new-profile'>;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const profileNavItems: NavItem[] = [
  { id: 'profiles', label: t.nav.allProfiles, icon: LayoutGrid },
  { id: 'folders', label: t.nav.folders, icon: Folder },
];

const systemNavItems: NavItem[] = [
  { id: 'proxies', label: t.nav.proxies, icon: Globe },
  { id: 'settings', label: t.nav.settings, icon: Settings },
];

interface SidebarProps {
  activePage: NavPageId;
  onSelectPage: (page: NavPageId) => void;
  appInfo: AppInfo | null;
}

export function Sidebar({ activePage, onSelectPage, appInfo }: SidebarProps): React.JSX.Element {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Brand header */}
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Shield className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              {t.app.name}
            </span>
            <span className="text-[11px] text-muted-foreground">{t.app.localMode}</span>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          v{appInfo?.version ?? '0.1.0'}
        </Badge>
      </div>

      {/* Primary action button like Hidemium */}
      <div className="px-3 pb-3 pt-1">
        <Button
          onClick={() => onSelectPage('new-profile')}
          variant={activePage === 'new-profile' ? 'default' : 'secondary'}
          className={cn(
            'w-full justify-center gap-2 font-medium',
            activePage !== 'new-profile' &&
              'border border-border bg-card text-foreground hover:bg-accent',
          )}
        >
          <Plus className="h-4 w-4" />
          <span>{t.nav.newProfile}</span>
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Navigation groups */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <div>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80">
            {t.nav.sectionProfiles}
          </p>
          <div className="space-y-1">
            {profileNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectPage(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80">
            {t.nav.sectionNetwork}
          </p>
          <div className="space-y-1">
            {systemNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectPage(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/15 text-primary'
                      : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Footer status */}
      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-lg border border-border bg-card/70 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t.status.ready}
            </span>
            <span className="text-muted-foreground">
              {appInfo ? `${t.status.electron} ${appInfo.electronVersion}` : t.status.webPreview}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
