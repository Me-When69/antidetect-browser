import { useState } from 'react';
import { Folder, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';

export function FoldersPage(): React.JSX.Element {
  const {
    locale,
    folders,
    profiles,
    refreshFolders,
    refreshProfiles,
    setFilter,
    setActivePage,
    showToast,
  } = useAppStore();
  const dict = getTranslations(locale);
  const [name, setName] = useState('');

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || !window.electronAPI) return;
    await window.electronAPI.createFolder(trimmed);
    setName('');
    await refreshFolders();
    showToast(`Đã tạo thư mục "${trimmed}"`, 'success');
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteFolder(id);
    await Promise.all([refreshFolders(), refreshProfiles()]);
    showToast('Đã xóa thư mục', 'info');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{dict.folders.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{dict.folders.subtitle}</p>
      </div>

      <Card className="flex max-w-xl items-center gap-3 p-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
          placeholder={dict.folders.placeholder}
        />
        <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
          <Plus className="h-4 w-4" />
          {dict.folders.createBtn}
        </Button>
      </Card>

      {folders.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">{dict.folders.empty}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => {
            const count = profiles.filter((p) => p.folderId === folder.id).length;
            return (
              <Card
                key={folder.id}
                className="flex items-center justify-between p-4 transition-colors hover:border-primary/40"
              >
                <button
                  type="button"
                  onClick={() => {
                    setFilter({ folderId: folder.id });
                    setActivePage('profiles');
                  }}
                  className="flex items-center gap-3 text-left"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Folder className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{folder.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {count} {dict.folders.profileCount}
                    </p>
                  </div>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDelete(folder.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
