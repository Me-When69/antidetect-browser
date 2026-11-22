import { useEffect, useState } from 'react';
import { Folder, Globe, LayoutGrid, PlusCircle, Settings } from 'lucide-react';
import { Sidebar, type NavPageId } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { t } from '@/i18n';
import type { AppInfo } from '@shared/ipc';

interface PageMeta {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: typeof LayoutGrid;
}

const pageMetadata: Record<NavPageId, PageMeta> = {
  profiles: {
    ...t.pages.allProfiles,
    icon: LayoutGrid,
  },
  folders: {
    ...t.pages.folders,
    icon: Folder,
  },
  proxies: {
    ...t.pages.proxies,
    icon: Globe,
  },
  settings: {
    ...t.pages.settings,
    icon: Settings,
  },
  'new-profile': {
    ...t.pages.newProfile,
    icon: PlusCircle,
  },
};

export function App(): React.JSX.Element {
  const [activePage, setActivePage] = useState<NavPageId>('profiles');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    const loadInfo = async (): Promise<void> => {
      if (!window.electronAPI) {
        return;
      }
      const info = await window.electronAPI.getAppInfo();
      if (active) {
        setAppInfo(info);
      }
    };
    void loadInfo();
    return () => {
      active = false;
    };
  }, []);

  const current = pageMetadata[activePage];
  const PageIcon = current.icon;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar activePage={activePage} onSelectPage={setActivePage} appInfo={appInfo} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={current.title} />

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">{current.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
          </div>

          <section className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <PageIcon className="h-6 w-6" />
            </div>
            <h3 className="text-base font-medium text-foreground">{current.emptyTitle}</h3>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              {current.emptyDescription}
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
