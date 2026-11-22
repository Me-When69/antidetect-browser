import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ProfilesPage } from '@/pages/ProfilesPage';
import { ProfileFormPage } from '@/pages/ProfileFormPage';
import { FoldersPage } from '@/pages/FoldersPage';
import { ProxiesPage } from '@/pages/ProxiesPage';
import { TrashPage } from '@/pages/TrashPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

export function App(): React.JSX.Element {
  const {
    activePage,
    editingProfileId,
    locale,
    theme,
    toast,
    bootstrap,
    setRunningStatus,
    setCommandPaletteOpen,
    showToast,
  } = useAppStore();
  const dict = getTranslations(locale);

  // Sync Dark/Light theme class on root <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
  }, [theme]);

  // Global Ctrl+K / Cmd+K Command Palette shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);

  useEffect(() => {
    void bootstrap();
    if (!window.electronAPI) return;
    const unsubscribe = window.electronAPI.onProfileRunStatus((event) => {
      setRunningStatus(event.profileId, event.running);
      if (event.error) {
        showToast(event.error, 'error');
      }
    });
    return () => {
      unsubscribe();
    };
  }, [bootstrap, setRunningStatus, showToast]);

  const pageTitle = (() => {
    switch (activePage) {
      case 'profiles':
        return dict.profiles.title;
      case 'folders':
        return dict.folders.title;
      case 'proxies':
        return dict.proxies.title;
      case 'trash':
        return locale === 'en' ? 'Trash' : 'Thùng rác';
      case 'settings':
        return dict.settings.title;
      case 'new-profile':
        return editingProfileId ? dict.form.editTitle : dict.form.newTitle;
    }
  })();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={pageTitle} />

        <main className="relative flex-1 overflow-y-auto p-6">
          {activePage === 'profiles' && <ProfilesPage />}
          {activePage === 'new-profile' && <ProfileFormPage />}
          {activePage === 'folders' && <FoldersPage />}
          {activePage === 'proxies' && <ProxiesPage />}
          {activePage === 'trash' && <TrashPage />}
          {activePage === 'settings' && <SettingsPage />}

          {toast && (
            <div
              className={cn(
                'fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg',
                toast.type === 'error'
                  ? 'border-destructive/60 bg-destructive text-destructive-foreground'
                  : toast.type === 'success'
                    ? 'border-primary/40 bg-card text-primary'
                    : 'border-border bg-card text-foreground',
              )}
            >
              {toast.text}
            </div>
          )}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

export default App;
