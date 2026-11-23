import { useState } from 'react';
import { Folder, Globe, Info, LayoutGrid, Mail, Plus, Settings, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FacetLogo } from '@/components/FacetLogo';
import { AboutModal } from '@/components/AboutModal';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';

export function Sidebar(): React.JSX.Element {
  const {
    activePage,
    setActivePage,
    openNewProfile,
    appInfo,
    locale,
    profiles,
    trashProfiles,
    folders,
    filter,
    setFilter,
    runningIds,
    refreshFolders,
    refreshProfiles,
    showToast,
  } = useAppStore();
  const dict = getTranslations(locale);

  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);

  const handleQuickCreateFolder = async (): Promise<void> => {
    const trimmed = newFolderName.trim();
    if (!trimmed || !window.electronAPI) return;
    await window.electronAPI.createFolder(trimmed);
    setNewFolderName('');
    setAddingFolder(false);
    await refreshFolders();
    showToast(
      locale === 'en' ? `Created folder "${trimmed}"` : `Đã tạo thư mục "${trimmed}"`,
      'success',
    );
  };

  const handleDeleteFolder = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteFolder(id);
    if (filter.folderId === id) {
      setFilter({ folderId: null });
    }
    await Promise.all([refreshFolders(), refreshProfiles()]);
  };

  const isAllProfilesActive = activePage === 'profiles' && !filter.folderId;
  const maxConcurrent = 10;
  const runningPercent = Math.min(100, Math.round((runningIds.length / maxConcurrent) * 100));

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Brand header — Facet */}
      <div className="flex h-14 items-center justify-between px-4">
        <FacetLogo size={28} showWordmark />
        <Badge variant="outline" className="font-mono text-[10px]">
          v{appInfo?.version ?? '0.1.0'}
        </Badge>
      </div>

      {/* Primary CTA */}
      <div className="px-3 pb-3 pt-1">
        <Button onClick={openNewProfile} className="w-full justify-center gap-2 font-semibold">
          <Plus className="h-4 w-4" />
          <span>{dict.nav.newProfile}</span>
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Main navigation + Inline Folders */}
      <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setFilter({ folderId: null });
              setActivePage('profiles');
            }}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              isAllProfilesActive
                ? 'bg-primary/15 text-primary'
                : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-2.5">
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span>{dict.nav.allProfiles}</span>
            </span>
            <span className="font-mono text-xs opacity-75">{profiles.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setActivePage('accounts')}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              activePage === 'accounts'
                ? 'bg-primary/15 text-primary'
                : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Mail className="h-4 w-4 shrink-0" />
            <span>{dict.nav.accounts}</span>
          </button>

          <button
            type="button"
            onClick={() => setActivePage('proxies')}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              activePage === 'proxies'
                ? 'bg-primary/15 text-primary'
                : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span>{dict.nav.proxies}</span>
          </button>

          <button
            type="button"
            onClick={() => setActivePage('trash')}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              activePage === 'trash'
                ? 'bg-primary/15 text-primary'
                : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-2.5">
              <Trash2 className="h-4 w-4 shrink-0" />
              <span>{locale === 'en' ? 'Trash' : 'Thùng rác'}</span>
            </span>
            {trashProfiles.length > 0 && (
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {trashProfiles.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePage('settings')}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              activePage === 'settings'
                ? 'bg-primary/15 text-primary'
                : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span>{dict.nav.settings}</span>
          </button>
        </div>

        {/* Inline Folders directly inside Sidebar */}
        <div>
          <div className="mb-1.5 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {dict.nav.folders}
            </span>
            <button
              type="button"
              onClick={() => setAddingFolder((prev) => !prev)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={dict.folders.createBtn}
              aria-label={dict.folders.createBtn}
            >
              {addingFolder ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </div>

          {addingFolder && (
            <div className="mb-2 flex gap-1 px-1">
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleQuickCreateFolder();
                  if (e.key === 'Escape') setAddingFolder(false);
                }}
                placeholder={dict.folders.placeholder}
                className="h-7 min-w-0 flex-1 rounded border border-input bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void handleQuickCreateFolder()}
              >
                +
              </Button>
            </div>
          )}

          {folders.length === 0 ? (
            <p className="px-2.5 text-xs text-muted-foreground/70">{dict.folders.empty}</p>
          ) : (
            <div className="space-y-0.5">
              {folders.map((folder) => {
                const count = profiles.filter((p) => p.folderId === folder.id).length;
                const active = activePage === 'profiles' && filter.folderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={cn(
                      'group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFilter({ folderId: folder.id });
                        setActivePage('profiles');
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[11px] opacity-70">{count}</span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFolder(folder.id)}
                        className="hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:inline-flex"
                        title={dict.common.delete}
                        aria-label={`${dict.common.delete} ${folder.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Footer quota card (Facet teal-to-violet gradient) + About */}
      <div className="space-y-2 border-t border-sidebar-border p-3">
        <div className="space-y-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">{dict.common.running}</span>
            <span className="font-mono text-[11px] font-semibold text-foreground">
              {runningIds.length} / {maxConcurrent}
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuenow={runningIds.length}
            aria-valuemin={0}
            aria-valuemax={maxConcurrent}
            aria-label={dict.common.running}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${runningPercent}%`,
                background: 'linear-gradient(90deg, #2DD4BF 0%, #7C5CFF 100%)',
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5" />
            <span>{dict.app.about} Facet</span>
          </span>
          <span className="font-mono text-[10px]">Apache-2.0</span>
        </button>
      </div>

      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        locale={locale}
        appInfo={appInfo}
      />
    </aside>
  );
}
