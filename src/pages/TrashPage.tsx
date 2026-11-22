import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/store/useAppStore';

export function TrashPage(): React.JSX.Element {
  const { locale, trashProfiles, refreshTrash, refreshProfiles, showToast } = useAppStore();
  const isEn = locale === 'en';

  const handleRestore = async (id: string, name: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.restoreProfile(id);
    await Promise.all([refreshTrash(), refreshProfiles()]);
    showToast(isEn ? `Restored "${name}"` : `Đã khôi phục hồ sơ "${name}"`, 'success');
  };

  const handlePermanentDelete = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.permanentDeleteProfile(id);
    await refreshTrash();
    showToast(isEn ? 'Permanently deleted profile' : 'Đã xóa vĩnh viễn hồ sơ', 'info');
  };

  const handleEmptyTrash = async (): Promise<void> => {
    if (!window.electronAPI || trashProfiles.length === 0) return;
    const count = await window.electronAPI.emptyTrash();
    await refreshTrash();
    showToast(
      isEn ? `Emptied trash (${count} profiles removed)` : `Đã dọn sạch thùng rác (${count} hồ sơ)`,
      'info',
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{isEn ? 'Trash' : 'Thùng rác'}</h2>
          <p className="text-sm text-muted-foreground">
            {isEn
              ? 'Soft-deleted profiles can be restored or permanently removed.'
              : 'Các hồ sơ đã xóa tạm được giữ ở đây để khôi phục hoặc xóa vĩnh viễn.'}
          </p>
        </div>

        {trashProfiles.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => void handleEmptyTrash()}>
            <Trash2 className="h-4 w-4" />
            {isEn ? 'Empty Trash' : 'Dọn sạch thùng rác'}
          </Button>
        )}
      </div>

      {trashProfiles.length === 0 ? (
        <Card className="flex min-h-[260px] flex-col items-center justify-center p-10 text-center">
          <Trash2 className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">
            {isEn ? 'Trash is empty' : 'Thùng rác đang trống'}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{isEn ? 'Profile Name' : 'Tên hồ sơ'}</th>
                <th className="px-4 py-3">{isEn ? 'Environment' : 'Môi trường'}</th>
                <th className="px-4 py-3">{isEn ? 'Deleted At' : 'Thời điểm xóa'}</th>
                <th className="px-4 py-3 text-right">{isEn ? 'Actions' : 'Thao tác'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trashProfiles.map((p) => (
                <tr key={p.id} className="hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="font-mono text-[11px] uppercase">
                      {p.platform} • {p.browser}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {p.deletedAt ? new Date(p.deletedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleRestore(p.id, p.name)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {isEn ? 'Restore' : 'Khôi phục'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handlePermanentDelete(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {isEn ? 'Delete Forever' : 'Xóa vĩnh viễn'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
