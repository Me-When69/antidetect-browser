import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ProfilesPage } from '@/pages/ProfilesPage';
import { ProfileFormPage } from '@/pages/ProfileFormPage';
import { FoldersPage } from '@/pages/FoldersPage';
import { ProxiesPage } from '@/pages/ProxiesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

export function App(): React.JSX.Element {
  const { activePage, editingProfileId, locale, toast, bootstrap, setRunningStatus, showToast } =
    useAppStore();
  const dict = getTranslations(locale);

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
          {activePage === 'settings' && <SettingsPage />}

          {toast && (
            <div
              className={cn(
                'fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-lg',
                toast.type === 'error'
                  ? 'border-destructive/60 bg-destructive text-destructive-foreground'
                  : toast.type === 'success'
                    ? 'border-emerald-500/40 bg-emerald-950/95 text-emerald-200'
                    : 'border-border bg-card text-foreground',
              )}
            >
              {toast.text}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
