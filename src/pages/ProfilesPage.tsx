import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cookie,
  Copy,
  Download,
  Edit3,
  FileSpreadsheet,
  Flame,
  Layers,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import { parseProfilesCsv } from '@shared/validation';
import type {
  BrowserType,
  BulkVersionPreviewItem,
  EmulatedDevice,
  ManagedBrowserVersion,
  Platform,
  Profile,
  ProfileStatus,
} from '@shared/types';

function formatDate(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const DEFAULT_WARMUP_URLS = [
  'https://www.wikipedia.org',
  'https://www.bbc.com',
  'https://news.ycombinator.com',
  'https://www.reddit.com',
].join('\n');

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
    refreshTrash,
    showToast,
  } = useAppStore();

  const dict = getTranslations(locale);
  const isEn = locale === 'en';

  // Bulk create modal state
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [bulkBaseName, setBulkBaseName] = useState('Profile');
  const [bulkCount, setBulkCount] = useState(5);
  const [bulkPlatform, setBulkPlatform] = useState<Platform>('windows');
  const [bulkBrowser, setBulkBrowser] = useState<BrowserType>('chrome');
  const [bulkProxiesText, setBulkProxiesText] = useState('');

  // CSV Import modal state
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvFolderId, setCsvFolderId] = useState('');

  // Warm-up modal state
  const [warmupProfile, setWarmupProfile] = useState<Profile | null>(null);
  const [warmupUrls, setWarmupUrls] = useState(DEFAULT_WARMUP_URLS);
  const [warmupMinSec, setWarmupMinSec] = useState(4);
  const [warmupMaxSec, setWarmupMaxSec] = useState(8);
  const [warmupScroll, setWarmupScroll] = useState(true);
  const [warmingUp, setWarmingUp] = useState(false);

  // Cookie modal state
  const [cookieProfile, setCookieProfile] = useState<Profile | null>(null);
  const [cookieInput, setCookieInput] = useState('');

  // Proxy check failed fallback modal state
  const [fallbackPrompt, setFallbackPrompt] = useState<{
    profileId: string;
    error: string;
  } | null>(null);

  // Missing browser modal state
  const [browserMissing, setBrowserMissing] = useState<{
    profileId: string;
    message: string;
    browser: 'chromium' | 'firefox';
  } | null>(null);
  const [installingChromium, setInstallingChromium] = useState(false);
  const [installPercent, setInstallPercent] = useState<number>(0);
  const [installFailed, setInstallFailed] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);

  // Bulk assign folder / device / version state
  const [bulkFolderId, setBulkFolderId] = useState('');
  const [bulkDeviceId, setBulkDeviceId] = useState('');
  const [bulkTargetVersion, setBulkTargetVersion] = useState('');
  const [versionPreview, setVersionPreview] = useState<BulkVersionPreviewItem[] | null>(null);

  // Filter by platform/version & sort
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all');
  const [versionFilter, setVersionFilter] = useState<string>('all');
  const [extraSort, setExtraSort] = useState<'none' | 'device' | 'version'>('none');

  // Devices & managed browsers
  const [devices, setDevices] = useState<EmulatedDevice[]>([]);
  const [managedBrowsers, setManagedBrowsers] = useState<ManagedBrowserVersion[]>([]);

  // Downgrade warning modal state
  const [downgradePrompt, setDowngradePrompt] = useState<{
    profileId: string;
    lastVersion: string;
    targetVersion: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    void Promise.all([
      window.electronAPI.listEmulatedDevices(),
      window.electronAPI.listManagedBrowsers(),
    ]).then(([devs, brs]) => {
      setDevices(devs);
      setManagedBrowsers(brs);
    });
  }, []);

  const distinctVersions = useMemo(() => {
    return Array.from(new Set(profiles.map((p) => p.browserVersion).filter(Boolean))).sort();
  }, [profiles]);

  const displayedProfiles = useMemo(() => {
    let list = profiles;
    if (platformFilter !== 'all') {
      list = list.filter((p) => p.platform === platformFilter);
    }
    if (versionFilter !== 'all') {
      list = list.filter((p) => p.browserVersion === versionFilter);
    }
    if (extraSort === 'device') {
      list = [...list].sort((a, b) =>
        (a.deviceLabel || a.platform).localeCompare(b.deviceLabel || b.platform),
      );
    } else if (extraSort === 'version') {
      list = [...list].sort((a, b) => b.browserVersion.localeCompare(a.browserVersion));
    }
    return list;
  }, [profiles, platformFilter, versionFilter, extraSort]);

  const allSelected =
    displayedProfiles.length > 0 && selectedIds.length === displayedProfiles.length;
  const csvPreviewCount = csvText.trim() ? parseProfilesCsv(csvText).length : 0;

  const handleToggleAll = (): void => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectedIds(displayedProfiles.map((p) => p.id));
    }
  };

  const handleStart = async (
    id: string,
    useFallbackGeo = false,
    allowDowngrade = false,
  ): Promise<void> => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.startProfile(id, {
        useFallbackGeo,
        allowDowngrade,
      });
      if (result.downgradeDetected || result.errorCode === 'VERSION_DOWNGRADE') {
        setDowngradePrompt({
          profileId: id,
          lastVersion: result.downgradeInfo?.lastVersion ?? '',
          targetVersion: result.downgradeInfo?.targetVersion ?? '',
          message:
            result.error ??
            'Hạ phiên bản trình duyệt có thể làm hỏng dữ liệu hồ sơ. Khuyến nghị nhân bản sang thư mục mới.',
        });
        return;
      }
      if (result.browserNotFound || result.errorCode === 'BROWSER_NOT_INSTALLED') {
        setBrowserMissing({
          profileId: id,
          message:
            result.error ??
            'Cần tải Firefox cho Playwright (khoảng 80 MB). Bạn có muốn tải bây giờ không?',
          browser: result.missingBrowser ?? 'chromium',
        });
        setInstallLogs([]);
        setInstallPercent(0);
        setInstallFailed(false);
        return;
      }
      if (result.proxyCheckFailed) {
        setFallbackPrompt({
          profileId: id,
          error: result.error ?? 'Không thể kiểm tra IP proxy để tự khớp vị trí/múi giờ.',
        });
        return;
      }
      await refreshProfiles();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể mở trình duyệt', 'error');
    }
  };

  const handleInstallChromium = async (): Promise<void> => {
    if (!window.electronAPI || !browserMissing) return;
    const { profileId, browser: target } = browserMissing;
    const label = target === 'firefox' ? 'Firefox' : 'Chromium';
    setInstallingChromium(true);
    setInstallFailed(false);
    setInstallPercent(0);
    setInstallLogs([]);
    const unsubscribe = window.electronAPI.onBrowserInstallProgress((ev) => {
      if (ev.browser !== target) return;
      if (typeof ev.percent === 'number') {
        setInstallPercent(ev.percent);
      }
      setInstallLogs((prev) => [...prev.slice(-40), ev.line]);
    });
    try {
      const res = await window.electronAPI.installPlaywrightChromium(target);
      if (res.ok) {
        showToast(`Đã tải ${label} thành công! Đang tự động mở lại hồ sơ...`, 'success');
        setBrowserMissing(null);
        await handleStart(profileId);
      } else {
        setInstallFailed(true);
        showToast(res.error ?? `Tải ${label} thất bại`, 'error');
      }
    } finally {
      unsubscribe();
      setInstallingChromium(false);
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
    showToast(isEn ? 'Duplicated profile with new fingerprint' : 'Đã nhân bản hồ sơ', 'success');
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteProfile(id);
    clearSelection();
    await Promise.all([refreshProfiles(), refreshTrash()]);
    showToast(isEn ? 'Moved profile to Trash' : 'Đã chuyển hồ sơ vào Thùng rác', 'info');
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
    await Promise.all([refreshProfiles(), refreshTrash()]);
    showToast(
      isEn ? `Moved ${count} profiles to Trash` : `Đã chuyển ${count} hồ sơ vào Thùng rác`,
      'info',
    );
  };

  const handleBulkAssignFolder = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0) return;
    await window.electronAPI.bulkUpdateProfiles({
      ids: selectedIds,
      folderId: bulkFolderId || null,
    });
    await refreshProfiles();
    showToast(isEn ? 'Updated folder' : 'Đã cập nhật thư mục hàng loạt', 'success');
  };

  const handleBulkAssignDevice = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0 || !bulkDeviceId) return;
    const count = await window.electronAPI.bulkUpdateProfiles({
      ids: selectedIds,
      deviceId: bulkDeviceId,
    });
    await refreshProfiles();
    showToast(`Đã đổi thiết bị cho ${count} hồ sơ`, 'success');
  };

  const handleOpenVersionPreview = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0 || !bulkTargetVersion) return;
    const preview = await window.electronAPI.previewBulkVersionUpdate(
      selectedIds,
      bulkTargetVersion,
    );
    setVersionPreview(preview);
  };

  const handleConfirmBulkVersion = async (): Promise<void> => {
    if (!window.electronAPI || selectedIds.length === 0 || !bulkTargetVersion) return;
    const count = await window.electronAPI.bulkUpdateProfiles({
      ids: selectedIds,
      browserVersion: bulkTargetVersion,
    });
    setVersionPreview(null);
    await refreshProfiles();
    showToast(`Đã cập nhật phiên bản ${bulkTargetVersion} cho ${count} hồ sơ`, 'success');
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
        ipv6Policy: 'block',
        geo: { mode: 'auto', timezone: '', language: 'en-US', lat: null, lon: null },
        fingerprint: identity.fingerprint,
        startup: { urls: [], restoreTabs: false },
      },
    });
    setShowBulkCreate(false);
    setBulkProxiesText('');
    await refreshProfiles();
    showToast(
      isEn ? `Created ${created.length} profiles` : `Đã tạo hàng loạt ${created.length} hồ sơ`,
      'success',
    );
  };

  const handleCsvImportSubmit = async (): Promise<void> => {
    if (!window.electronAPI || !csvText.trim()) return;
    const created = await window.electronAPI.importProfilesCsv(csvText, csvFolderId || null);
    setShowCsvModal(false);
    setCsvText('');
    await refreshProfiles();
    showToast(
      isEn
        ? `Imported ${created.length} profiles from CSV`
        : `Đã nhập ${created.length} hồ sơ từ CSV`,
      'success',
    );
  };

  const handleRunWarmup = async (): Promise<void> => {
    if (!window.electronAPI || !warmupProfile) return;
    const urls = warmupUrls
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) return;

    setWarmingUp(true);
    try {
      const res = await window.electronAPI.warmupProfile(warmupProfile.id, {
        urls,
        minStaySec: Math.max(1, warmupMinSec),
        maxStaySec: Math.max(warmupMinSec, warmupMaxSec),
        scroll: warmupScroll,
      });
      await refreshProfiles();
      setWarmupProfile(null);
      showToast(
        isEn
          ? `Warm-up done: ${res.visited} visited, ${res.failed} failed`
          : `Warm-up hoàn tất: đã truy cập ${res.visited} trang (${res.failed} lỗi)`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Warm-up failed', 'error');
    } finally {
      setWarmingUp(false);
    }
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

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCsvModal(true)}>
            <FileSpreadsheet className="h-4 w-4" />
            {isEn ? 'Import CSV' : 'Nhập CSV'}
          </Button>
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
          <option value="none">None</option>
          <option value="ready">Ready</option>
          <option value="warming">Warming</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
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
          className="w-36"
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value as Platform | 'all')}
        >
          <option value="all">Thiết bị: Tất cả</option>
          <option value="windows">Windows</option>
          <option value="macos">macOS</option>
          <option value="linux">Linux</option>
          <option value="android">Android</option>
          <option value="ios">iOS</option>
        </Select>

        {distinctVersions.length > 0 && (
          <Select
            className="w-40"
            value={versionFilter}
            onChange={(e) => setVersionFilter(e.target.value)}
          >
            <option value="all">Phiên bản: Tất cả</option>
            {distinctVersions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </Select>
        )}

        <Select
          className="w-44"
          value={extraSort !== 'none' ? `extra:${extraSort}` : (filter.sortBy ?? 'createdAt')}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'extra:device') {
              setExtraSort('device');
            } else if (val === 'extra:version') {
              setExtraSort('version');
            } else {
              setExtraSort('none');
              setFilter({ sortBy: val as 'name' | 'createdAt' | 'lastRunAt' });
            }
          }}
        >
          <option value="createdAt">{isEn ? 'Sort: Newest' : 'Sắp xếp: Mới nhất'}</option>
          <option value="name">{isEn ? 'Sort: Name A-Z' : 'Sắp xếp: Tên A-Z'}</option>
          <option value="lastRunAt">{isEn ? 'Sort: Last Run' : 'Sắp xếp: Chạy gần nhất'}</option>
          <option value="extra:device">Sắp xếp: Thiết bị</option>
          <option value="extra:version">Sắp xếp: Phiên bản</option>
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
              className="h-8 w-32 text-xs"
              value={bulkFolderId}
              onChange={(e) => setBulkFolderId(e.target.value)}
            >
              <option value="">{dict.common.none}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="outline" onClick={() => void handleBulkAssignFolder()}>
              {dict.profiles.assignFolder}
            </Button>

            <Select
              className="h-8 w-40 text-xs"
              value={bulkDeviceId}
              onChange={(e) => setBulkDeviceId(e.target.value)}
            >
              <option value="">-- Đổi thiết bị --</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  [{d.platform.toUpperCase()}] {d.label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!bulkDeviceId}
              onClick={() => void handleBulkAssignDevice()}
            >
              Đổi thiết bị
            </Button>

            <Select
              className="h-8 w-40 text-xs"
              value={bulkTargetVersion}
              onChange={(e) => setBulkTargetVersion(e.target.value)}
            >
              <option value="">-- Đổi phiên bản --</option>
              {managedBrowsers
                .filter((b) => b.installed && b.browserKind === 'chrome')
                .map((b) => (
                  <option key={b.id} value={b.version}>
                    Chrome {b.version}
                  </option>
                ))}
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={!bulkTargetVersion}
              onClick={() => void handleOpenVersionPreview()}
            >
              Cập nhật phiên bản
            </Button>

            <Button size="sm" variant="destructive" onClick={() => void handleBulkDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              {dict.profiles.bulkDelete}
            </Button>
          </div>
        </Card>
      )}

      {/* Table */}
      {displayedProfiles.length === 0 ? (
        <Card className="flex min-h-[300px] flex-col items-center justify-center p-10 text-center">
          <p className="text-base font-medium">{dict.profiles.emptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{dict.profiles.emptyDesc}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left text-sm">
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
                <th className="px-4 py-3">Thiết bị</th>
                <th className="px-4 py-3">Phiên bản</th>
                <th className="px-4 py-3">{dict.profiles.colStatus}</th>
                <th className="px-4 py-3">{dict.profiles.colTags}</th>
                <th className="px-4 py-3">{dict.profiles.colProxy}</th>
                <th className="px-4 py-3">{dict.profiles.colLastRun}</th>
                <th className="px-4 py-3 text-right">{dict.profiles.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedProfiles.map((profile) => {
                const isRunning = runningIds.includes(profile.id);
                const isChecked = selectedIds.includes(profile.id);
                const folderName = profile.folderId ? folderMap.get(profile.folderId) : null;

                return (
                  <tr key={profile.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectProfile(profile.id)}
                        className="rounded border-border bg-card"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{profile.name}</div>
                      {folderName && (
                        <div className="mt-0.5 text-[11px] text-primary">{folderName}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="max-w-[200px] truncate text-xs font-medium text-foreground">
                        {profile.deviceLabel || `${profile.platform.toUpperCase()} (${profile.osVersion})`}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                        {profile.platform} • {profile.fingerprint.screen.width}x{profile.fingerprint.screen.height}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {profile.browser === 'firefox' ? 'FF' : 'CR'} {profile.browserVersion}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {isRunning ? (
                          <Badge className="bg-primary/15 text-primary">
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
                    <td className="px-4 py-2.5">
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
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {profile.proxy.type === 'none'
                        ? dict.profiles.noProxy
                        : `${profile.proxy.type.toUpperCase()} ${profile.proxy.host}:${profile.proxy.port}`}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {formatDate(profile.lastRunAt, dict.profiles.neverRun)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
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
                          className="h-8 w-8 text-amber-500 hover:text-amber-400"
                          title="Profile Warm-up"
                          onClick={() => setWarmupProfile(profile)}
                        >
                          <Flame className="h-4 w-4" />
                        </Button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-lg space-y-4 p-6 shadow-2xl">
            <h3 className="text-base font-semibold">{dict.profiles.bulkCreate}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {isEn ? 'Base Name' : 'Tên gốc'}
                </label>
                <Input value={bulkBaseName} onChange={(e) => setBulkBaseName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {isEn ? 'Count (1-200)' : 'Số lượng (1-200)'}
                </label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={bulkCount}
                  onChange={(e) => setBulkCount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Platform</label>
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
                <label className="mb-1 block text-xs text-muted-foreground">Browser</label>
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
                {isEn
                  ? 'Proxy list (one per line: host:port:user:pass — optional)'
                  : 'Danh sách proxy (mỗi dòng 1 proxy dạng host:port:user:pass — tùy chọn)'}
              </label>
              <Textarea
                rows={4}
                value={bulkProxiesText}
                onChange={(e) => setBulkProxiesText(e.target.value)}
                placeholder="1.2.3.4:8080:user:pass"
                className="font-mono text-xs"
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

      {/* CSV Import modal */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-xl space-y-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {isEn ? 'Import Profiles from CSV' : 'Nhập hồ sơ hàng loạt từ CSV'}
              </h3>
              <label className="cursor-pointer rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-accent">
                {isEn ? 'Choose .csv file' : 'Chọn file .csv'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void file.text().then((txt) => setCsvText(txt));
                    }
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {isEn
                ? 'Columns: name,proxy,tags,notes,platform,browser (tags separated by ;)'
                : 'Các cột hỗ trợ: name,proxy,tags,notes,platform,browser (nhiều thẻ cách nhau bằng dấu ;)'}
            </p>
            <Textarea
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`name,proxy,tags,notes,platform,browser\nStore US 01,1.2.3.4:8080:usr:pwd,us;shop,main account,windows,chrome`}
              className="font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-3">
              <Select
                className="w-48"
                value={csvFolderId}
                onChange={(e) => setCsvFolderId(e.target.value)}
              >
                <option value="">
                  {dict.folders.title}: {dict.common.none}
                </option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setShowCsvModal(false)}>
                  {dict.common.cancel}
                </Button>
                <Button
                  disabled={csvPreviewCount === 0}
                  onClick={() => void handleCsvImportSubmit()}
                >
                  <Upload className="h-4 w-4" />
                  {isEn ? `Import (${csvPreviewCount})` : `Nhập (${csvPreviewCount})`}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Profile Warm-up modal */}
      {warmupProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-lg space-y-4 p-6 shadow-2xl">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-semibold">Warm-up: {warmupProfile.name}</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {isEn
                ? 'Automatically visits everyday sites with human-like scrolling and pauses to build natural cookies.'
                : 'Tự động truy cập các trang web phổ biến kèm cuộn trang và dừng ngẫu nhiên như người thật để nuôi cookie.'}
            </p>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {isEn ? 'Target URLs (one per line)' : 'Danh sách URL (mỗi dòng 1 link)'}
              </label>
              <Textarea
                rows={5}
                value={warmupUrls}
                onChange={(e) => setWarmupUrls(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {isEn ? 'Min stay (sec)' : 'Dừng tối thiểu (giây)'}
                </label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={warmupMinSec}
                  onChange={(e) => setWarmupMinSec(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {isEn ? 'Max stay (sec)' : 'Dừng tối đa (giây)'}
                </label>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={warmupMaxSec}
                  onChange={(e) => setWarmupMaxSec(Number(e.target.value))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={warmupScroll}
                onChange={(e) => setWarmupScroll(e.target.checked)}
              />
              {isEn ? 'Simulate human mouse wheel scrolling' : 'Giả lập cuộn chuột tự nhiên'}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={warmingUp} onClick={() => setWarmupProfile(null)}>
                {dict.common.cancel}
              </Button>
              <Button disabled={warmingUp} onClick={() => void handleRunWarmup()}>
                {warmingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Flame className="h-4 w-4" />
                )}
                {warmingUp
                  ? isEn
                    ? 'Warming up...'
                    : 'Đang chạy warm-up...'
                  : isEn
                    ? 'Start Warm-up'
                    : 'Bắt đầu Warm-up'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Missing browser friendly modal with progress bar, retry & auto-relaunch */}
      {browserMissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-lg space-y-4 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">
              Cần tải {browserMissing.browser === 'firefox' ? 'Firefox' : 'Chromium'}
            </h3>
            <p className="text-sm text-muted-foreground">{browserMissing.message}</p>

            {(installingChromium || installPercent > 0) && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Tiến trình tải</span>
                  <span className="font-mono">{installPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${installPercent}%` }}
                  />
                </div>
              </div>
            )}

            {installLogs.length > 0 && (
              <pre className="max-h-36 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-muted-foreground">
                {installLogs.join('\n')}
              </pre>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={installingChromium}
                onClick={() => setBrowserMissing(null)}
              >
                Hủy
              </Button>
              <Button disabled={installingChromium} onClick={() => void handleInstallChromium()}>
                {installingChromium ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {installingChromium
                  ? `Đang tải (${installPercent}%)...`
                  : installFailed
                    ? 'Thử lại'
                    : 'Tải về'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Proxy geo check failed fallback modal */}
      {fallbackPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-md space-y-4 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-destructive">Không thể kiểm tra proxy</h3>
            <p className="text-sm text-muted-foreground">{fallbackPrompt.error}</p>
            <p className="text-xs text-muted-foreground">
              Trình duyệt chưa được mở để tránh lộ múi giờ/vị trí không khớp. Bạn có muốn mở bằng
              cấu hình geo đã lưu lần trước không?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFallbackPrompt(null)}>
                Hủy
              </Button>
              <Button
                onClick={() => {
                  const targetId = fallbackPrompt.profileId;
                  setFallbackPrompt(null);
                  void handleStart(targetId, true);
                }}
              >
                Mở bằng cấu hình geo đã lưu lần trước
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Bulk Version Update Preview Modal */}
      {versionPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-xl space-y-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                Xem trước cập nhật phiên bản trình duyệt ({versionPreview.length} hồ sơ)
              </h3>
              <Button size="sm" variant="ghost" onClick={() => setVersionPreview(null)}>
                Đóng
              </Button>
            </div>
            {versionPreview.some((item) => item.action === 'downgrade') && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Có hồ sơ bị hạ phiên bản (downgrade). Hạ phiên bản có thể gây lỗi dữ liệu hồ sơ cũ
                  khi mở lại.
                </span>
              </div>
            )}
            <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-xs">
              {versionPreview.map((item) => (
                <div
                  key={item.profileId}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="font-medium">{item.profileName}</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-muted-foreground">{item.currentVersion}</span>
                    <span>→</span>
                    <span>{item.targetVersion}</span>
                    <Badge
                      className={
                        item.action === 'upgrade'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : item.action === 'downgrade'
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-secondary text-muted-foreground'
                      }
                    >
                      {item.action === 'upgrade'
                        ? 'Nâng cấp'
                        : item.action === 'downgrade'
                          ? 'Hạ phiên bản'
                          : 'Giữ nguyên'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setVersionPreview(null)}>
                Hủy
              </Button>
              <Button onClick={() => void handleConfirmBulkVersion()}>
                Áp dụng cho {versionPreview.length} hồ sơ
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Downgrade Warning Modal */}
      {downgradePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-md space-y-4 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-base font-semibold">Cảnh báo hạ phiên bản trình duyệt</h3>
            </div>
            <p className="text-sm text-muted-foreground">{downgradePrompt.message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setDowngradePrompt(null)}>
                Hủy
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const id = downgradePrompt.profileId;
                  setDowngradePrompt(null);
                  await handleDuplicate(id);
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Nhân bản sang thư mục mới
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const id = downgradePrompt.profileId;
                  setDowngradePrompt(null);
                  void handleStart(id, false, true);
                }}
              >
                Vẫn mở (Rủi ro)
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Cookie import/export modal */}
      {cookieProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <Card className="w-full max-w-xl space-y-4 p-6 shadow-2xl">
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
              placeholder='[{"name":"...","value":"...","domain":".example.com"}] or Netscape format...'
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
