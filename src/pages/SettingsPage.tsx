import { useEffect, useState } from 'react';
import { Copy, Download, FileText, KeyRound, RefreshCw, Save, Server, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import type { BackupPayload, LocaleCode } from '@shared/types';

function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SettingsPage(): React.JSX.Element {
  const {
    locale,
    settings,
    apiStatus,
    setLocale,
    refreshSettings,
    refreshProfiles,
    refreshFolders,
    refreshProxies,
    showToast,
  } = useAppStore();
  const dict = getTranslations(locale);

  const [chromePath, setChromePath] = useState(settings.chromePath);
  const [camoufoxPath, setCamoufoxPath] = useState(settings.camoufoxPath);
  const [apiEnabled, setApiEnabled] = useState(settings.localApiEnabled);
  const [apiPort, setApiPort] = useState(settings.localApiPort);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    setChromePath(settings.chromePath);
    setCamoufoxPath(settings.camoufoxPath);
    setApiEnabled(settings.localApiEnabled);
    setApiPort(settings.localApiPort);
  }, [settings]);

  const handleSave = async (): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.updateSettings({
      chromePath,
      camoufoxPath,
      localApiEnabled: apiEnabled,
      localApiPort: Number(apiPort) || 36912,
    });
    await refreshSettings();
    showToast('Đã lưu cài đặt hệ thống', 'success');
  };

  const handleRegenKey = async (): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.regenerateApiKey();
    await refreshSettings();
    showToast('Đã tạo API Key mới', 'success');
  };

  const handleCopyKey = async (): Promise<void> => {
    await navigator.clipboard.writeText(settings.localApiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  };

  const handleExportBackup = async (): Promise<void> => {
    if (!window.electronAPI) return;
    const payload = await window.electronAPI.exportBackup();
    downloadTextFile(
      `antidetect-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
    );
    showToast('Đã xuất file sao lưu JSON', 'success');
  };

  const handleImportBackup = async (file: File | undefined): Promise<void> => {
    if (!file || !window.electronAPI) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      const res = await window.electronAPI.importBackup(payload);
      await Promise.all([refreshProfiles(), refreshFolders(), refreshProxies()]);
      showToast(
        `Đã khôi phục ${res.profiles} hồ sơ, ${res.folders} thư mục, ${res.proxies} proxy`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'File sao lưu không hợp lệ', 'error');
    }
  };

  const handleExportLogs = async (): Promise<void> => {
    if (!window.electronAPI) return;
    const logs = await window.electronAPI.exportLogs();
    downloadTextFile(
      `antidetect-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      logs || 'No logs recorded yet.',
      'text/plain',
    );
    showToast('Đã xuất file log hỗ trợ', 'success');
  };

  const baseUrl = apiStatus?.baseUrl ?? `http://127.0.0.1:${settings.localApiPort}`;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{dict.settings.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{dict.settings.subtitle}</p>
      </div>

      {/* Language */}
      <Card className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">{dict.settings.language}</h3>
        <Select
          className="max-w-xs"
          value={locale}
          onChange={(e) => void setLocale(e.target.value as LocaleCode)}
        >
          <option value="vi">Tiếng Việt (VI)</option>
          <option value="en">English (EN)</option>
        </Select>
      </Card>

      {/* Browser binaries */}
      <Card className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">{dict.settings.browserPaths}</h3>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {dict.settings.chromePath}
          </label>
          <Input
            value={chromePath}
            onChange={(e) => setChromePath(e.target.value)}
            placeholder="C:\Program Files\Google\Chrome\Application\chrome.exe"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {dict.settings.camoufoxPath}
          </label>
          <Input
            value={camoufoxPath}
            onChange={(e) => setCamoufoxPath(e.target.value)}
            placeholder="C:\Users\...\camoufox\camoufox.exe"
          />
        </div>
      </Card>

      {/* Local REST API */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{dict.settings.localApi}</h3>
          </div>
          <Badge
            className={
              apiStatus?.running
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-secondary text-muted-foreground'
            }
          >
            {apiStatus?.running ? `ONLINE • ${baseUrl}` : 'OFFLINE'}
          </Badge>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={apiEnabled}
            onChange={(e) => setApiEnabled(e.target.checked)}
          />
          {dict.settings.enableApi}
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {dict.settings.apiPort}
            </label>
            <Input
              type="number"
              value={apiPort}
              onChange={(e) => setApiPort(Number(e.target.value))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-muted-foreground">
              {dict.settings.apiKey}
            </label>
            <div className="flex gap-2">
              <Input readOnly value={settings.localApiKey} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopyKey()}
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedKey ? dict.common.copied : dict.common.copy}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleRegenKey()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-muted-foreground">
          {`curl -H "x-api-key: ${settings.localApiKey}" ${baseUrl}/profiles
curl -X POST -H "x-api-key: ${settings.localApiKey}" ${baseUrl}/profiles/<ID>/start`}
        </pre>

        <div>
          <Button onClick={() => void handleSave()}>
            <Save className="h-4 w-4" />
            {dict.common.save}
          </Button>
        </div>
      </Card>

      {/* Backup & Support */}
      <Card className="space-y-4 p-5">
        <h3 className="text-sm font-semibold">{dict.settings.backupTitle}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void handleExportBackup()}>
            <Download className="h-4 w-4" />
            {dict.settings.exportBackup}
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium hover:bg-accent">
            <Upload className="h-4 w-4" />
            {dict.settings.importBackup}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => void handleImportBackup(e.target.files?.[0])}
            />
          </label>
          <Button variant="secondary" onClick={() => void handleExportLogs()}>
            <FileText className="h-4 w-4" />
            {dict.settings.exportLogs}
          </Button>
        </div>
      </Card>
    </div>
  );
}
