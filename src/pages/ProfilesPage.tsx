import { useState } from 'react';
import {
  Cookie,
  Copy,
  Edit3,
  Layers,
  Play,
  Plus,
  Square,
  Trash2,
  Upload,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import type { BrowserType, Platform, Profile, ProfileStatus } from '@shared/types';

function formatDate(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ProfilesPage(): React.JSX.Element {
  const {
    locale,
    profiles,
    folders,
    tags,
    runningIds,
    selectedIds,
    filter,
    setFilter,
    toggleSelectProfile,
    setSelectedIds,
    clearSelection,
    openNewProfile,
    openEditProfile,
    refreshProfiles,
    showToast,
  } = useAppStore();

  const dict = getTranslations(locale);

  // Bulk create modal state
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [bulkBaseName, setBulkBaseName] = useState('Profile');
  const [bulkCount, setBulkCount] = useState(5);
  const [bulkPlatform, setBulkPlatform] = useState<Platform>('windows');
  const [bulkBrowser, setBulkBrowser] = useState<BrowserType>('chrome');
  const [bulkProxiesText, setBulkProxiesText] = useState('');

  // Cookie modal state
  const [cookieProfile, setCookieProfile] = useState<Profile | null>(null);
  const [cookieInput, setCookieInput] = useState('');

  // Bulk assign folder state
  const [bulkFolderId, setBulkFolderId] = useState('');

  const allSelected = profiles.length > 0 && selectedIds.length === profiles.length;

  const handleToggleAll = (): void => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedIds(profiles.map((p) => p.id));
    }
  };

  const handleStart = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.startProfile(id);
      await refreshProfiles();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể mở trình duyệt', 'error');
    }
  };

  const handleStop = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.stopProfile(id);
  };

  const handleDuplicate = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.duplicateProfile(id);
    await refreshProfiles();
    showToast('Đã nhân bản hồ sơ với dấu vân tay mới', 'success');
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteProfile(id);
    clearSelection();
    await refreshProfiles();
    showToast('Đã xóa hồ sơ', 'info');
  };

  const handleBulkStart = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0) return;
    await window.electronAPI.bulkStartProfiles(selectedIds);
    await refreshProfiles();
  };

  const handleBulkStop = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0) return;
    await window.electronAPI.bulkStopProfiles(selectedIds);
  };

  const handleBulkDelete = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0) return;
    const count = await window.electronAPI.bulkDeleteProfiles(selectedIds);
    clearSelection();
    await refreshProfiles();
    showToast(`Đã xóa ${count} hồ sơ`, 'info');
  };

  const handleBulkAssignFolder = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0) return;
    await window.electronAPI.bulkUpdateProfiles({
      ids: selectedIds,
      folderId: bulkFolderId || null,
    });
    await refreshProfiles();
    showToast('Đã cập nhật thư mục hàng loạt', 'success');
  };

  const handleBulkCreateSubmit = async (): Promise<void> => {
    if (!window.electronAPI) return;
    const identity = await window.electronAPI.generateFingerprint(bulkPlatform, bulkBrowser);
    const proxyLines = bulkProxiesText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const created = await window.electronAPI.bulkCreateProfiles({
      baseName: bulkBaseName.trim() || 'Profile',
      count: Math.max(1, Math.min(200, bulkCount)),
      proxyList: proxyLines,
      template: {
        name: bulkBaseName.trim() || 'Profile',
        folderId: null,
        status: 'none',
        tags: [],
        notes: '',
        platform: identity.platform,
        osVersion: identity.osVersion,
        browser: identity.browser,
        browserVersion: identity.browserVersion,
        userAgent: identity.userAgent,
        proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
        geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
        fingerprint: identity.fingerprint,
        startup: { urls: [], restoreTabs: false },
      },
    });
    setShowBulkCreate(false);
    setBulkProxiesText('');
    await refreshProfiles();
    showToast(`Đã tạo hàng loạt ${created.length} hồ sơ`, 'success');
  };

  const handleImportCookies = async (): Promise<void> => {
    if (!window.electronAPI || !cookieProfile || !cookieInput.trim()) return;
    try {
      const count = await window.electronAPI.importCookies(cookieProfile.id, cookieInput);
      showToast(`Đã nhập ${count} cookie cho "${cookieProfile.name}"`, 'success');
      setCookieInput('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi đọc định dạng cookie', 'error');
    }
  };

  const handleExportCookies = async (format: 'json' | 'netscape'): Promise<void> => {
    if (!window.electronAPI || !cookieProfile) return;
    const text = await window.electronAPI.exportCookies(cookieProfile.id, format);
    setCookieInput(text);
    showToast(`Đã xuất cookie dạng ${format.toUpperCase()}`, 'success');
  };

  const folderMap = new Map(folders.map((f) => [f.id, f.name]));

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{dict.profiles.title}</h2>
          <p className="text-sm text-muted-foreground">{dict.profiles.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowBulkCreate(true)}>
            <Layers className="h-4 w-4" />
            {dict.profiles.bulkCreate}
          </Button>
          <Button size="sm" onClick={openNewProfile}>
            <Plus className="h-4 w-4" />
            {dict.nav.newProfile}
          </Button>
        </div>
      </div>

      {/* Filters bar */}
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <Select
          className="w-44"
          value={filter.folderId ?? ''}
          onChange={(e) => setFilter({ folderId: e.target.value || null })}
        >
          <option value="">
            {dict.folders.title}: {dict.common.all}
          </option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>

        <Select
          className="w-40"
          value={filter.status ?? 'all'}
          onChange={(e) => setFilter({ status: e.target.value as ProfileStatus | 'all' })}
        >
          <option value="all">
            {dict.profiles.colStatus}: {dict.common.all}
          </option>
          <option value="none">Không có</option>
          <option value="ready">Sẵn sàng</option>
          <option value="warming">Đang nuôi</option>
          <option value="active">Hoạt động</option>
          <option value="banned">Bị khóa</option>
        </Select>

        {tags.length > 0 && (
          <Select
            className="w-36"
            value={filter.tag ?? ''}
            onChange={(e) => setFilter({ tag: e.target.value })}
          >
            <option value="">
              {dict.profiles.colTags}: {dict.common.all}
            </option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </Select>
        )}

        <Select
          className="w-40"
          value={filter.sortBy ?? 'createdAt'}
          onChange={(e) =>
            setFilter({ sortBy: e.target.value as 'name' | 'createdAt' | 'lastRunAt' })
          }
        >
          <option value="createdAt">Sắp xếp: Mới nhất</option>
          <option value="name">Sắp xếp: Tên A-Z</option>
          <option value="lastRunAt">Sắp xếp: Chạy gần nhất</option>
        </Select>
      </Card>

      {/* Bulk action toolbar */}
      {selectedIds.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/10 px-4 py-2.5">
          <span className="text-sm font-medium text-primary">
            {selectedIds.length} {dict.profiles.selectedCount}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleBulkStart()}>
              <Play className="h-3.5 w-3.5" />
              {dict.profiles.bulkStart}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleBulkStop()}>
              <Square className="h-3.5 w-3.5" />
              {dict.profiles.bulkStop}
            </Button>
            <Select
              className="h-8 w-36 text-xs"
              value={bulkFolderId}
              onChange={(e) => setBulkFolderId(e.target.value)}
            >
              <option value="">Không thư mục</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="outline" onClick={() => void handleBulkAssignFolder()}>
              {dict.profiles.assignFolder}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void handleBulkDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              {dict.profiles.bulkDelete}
            </Button>
          </div>
        </Card>
      )}

      {/* Table */}
      {profiles.length === 0 ? (
        <Card className="flex min-h-[300px] flex-col items-center justify-center p-10 text-center">
          <p className="text-base font-medium">{dict.profiles.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{dict.profiles.emptyDesc}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleToggleAll}
                    className="rounded border-border bg-card"
                  />
                </th>
                <th className="px-4 py-3">{dict.profiles.colName}</th>
                <th className="px-4 py-3">{dict.profiles.colStatus}</th>
                <th className="px-4 py-3">{dict.profiles.colTags}</th>
                <th className="px-4 py-3">{dict.profiles.colProxy}</th>
                <th className="px-4 py-3">{dict.profiles.colLastRun}</th>
                <th className="px-4 py-3 text-right">{dict.profiles.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {profiles.map((profile) => {
                const isRunning = runningIds.includes(profile.id);
                const isChecked = selectedIds.includes(profile.id);
                const folderName = profile.folderId ? folderMap.get(profile.folderId) : null;

                return (
                  <tr key={profile.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectProfile(profile.id)}
                        className="rounded border-border bg-card"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{profile.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="uppercase">{profile.platform}</span>
                        <span>•</span>
                        <span className="capitalize">
                          {profile.browser === 'firefox' ? 'Firefox (Camoufox)' : 'Chrome'}
                        </span>
                        {folderName && (
                          <>
                            <span>•</span>
                            <span className="text-primary">{folderName}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isRunning ? (
                          <Badge className="bg-emerald-500/20 text-emerald-400">
                            {dict.common.running}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{dict.common.stopped}</Badge>
                        )}
                        {profile.status !== 'none' && (
                          <Badge variant="secondary">{profile.status}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {profile.tags.length > 0 ? (
                          profile.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[11px]">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {profile.proxy.type === 'none'
                        ? dict.profiles.noProxy
                        : `${profile.proxy.type.toUpperCase()} ${profile.proxy.host}:${profile.proxy.port}`}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(profile.lastRunAt, dict.profiles.neverRun)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {isRunning ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleStop(profile.id)}
                          >
                            <Square className="h-3.5 w-3.5" />
                            {dict.common.stop}
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => void handleStart(profile.id)}>
                            <Play className="h-3.5 w-3.5" />
                            {dict.common.run}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title={dict.common.edit}
                          onClick={() => openEditProfile(profile.id)}
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title={dict.common.duplicate}
                          onClick={() => void handleDuplicate(profile.id)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title={dict.profiles.cookies}
                          onClick={() => {
                            setCookieProfile(profile);
                            setCookieInput('');
                          }}
                        >
                          <Cookie className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title={dict.common.delete}
                          onClick={() => void handleDelete(profile.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Bulk create modal */}
      {showBulkCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-lg space-y-4 p-6">
            <h3 className="text-base font-semibold">{dict.profiles.bulkCreate}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Tên gốc</label>
                <Input value={bulkBaseName} onChange={(e) => setBulkBaseName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Số lượng (1-200)</label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={bulkCount}
                  onChange={(e) => setBulkCount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Nền tảng</label>
                <Select
                  value={bulkPlatform}
                  onChange={(e) => setBulkPlatform(e.target.value as Platform)}
                >
                  <option value="windows">Windows</option>
                  <option value="macos">macOS</option>
                  <option value="linux">Linux</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Trình duyệt</label>
                <Select
                  value={bulkBrowser}
                  onChange={(e) => setBulkBrowser(e.target.value as BrowserType)}
                >
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox (Camoufox)</option>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Danh sách proxy (mỗi dòng 1 proxy dạng host:port:user:pass — tùy chọn)
              </label>
              <Textarea
                rows={4}
                value={bulkProxiesText}
                onChange={(e) => setBulkProxiesText(e.target.value)}
                placeholder="1.2.3.4:8080:user:pass"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowBulkCreate(false)}>
                {dict.common.cancel}
              </Button>
              <Button onClick={() => void handleBulkCreateSubmit()}>
                {dict.common.create} ({bulkCount})
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Cookie import/export modal */}
      {cookieProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-xl space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {dict.profiles.cookies}: {cookieProfile.name}
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setCookieProfile(null)}>
                {dict.common.close}
              </Button>
            </div>
            <Textarea
              rows={8}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder='Dán JSON cookies [{"name":"...","value":"...","domain":".example.com"}] hoặc định dạng Netscape...'
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleExportCookies('json')}
                >
                  <Download className="h-3.5 w-3.5" />
                  {dict.profiles.exportJson}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleExportCookies('netscape')}
                >
                  <Download className="h-3.5 w-3.5" />
                  {dict.profiles.exportNetscape}
                </Button>
              </div>
              <Button size="sm" onClick={() => void handleImportCookies()}>
                <Upload className="h-3.5 w-3.5" />
                {dict.profiles.importCookies}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
