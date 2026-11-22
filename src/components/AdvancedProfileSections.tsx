import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import {
  ChevronDown,
  ChevronRight,
  Gauge,
  Info,
  RotateCcw,
  Save,
  Shield,
  Sliders,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DEFAULT_BANDWIDTH,
  DEFAULT_BEHAVIOR,
  DEFAULT_DATA_ON_CLOSE,
  DEFAULT_MEDIA_DEVICES,
  DEFAULT_META,
  DEFAULT_SIGNALS,
  DEFAULT_WINDOW,
  normalizeBandwidth,
  normalizeBehavior,
  normalizeDataOnClose,
  normalizeMediaDevices,
  normalizeMeta,
  normalizeSignals,
  normalizeWindow,
} from '@shared/advancedDefaults';
import { getBrowserCapabilities } from '@shared/browserSupport';
import type {
  BrowserType,
  CreateProfileInput,
  ProfilePreset,
  ProfileSignals,
  SignalMode,
} from '@shared/types';

const LABEL_COLORS = [
  { hex: '#10b981', name: 'Ngọc lục bảo' },
  { hex: '#3b82f6', name: 'Xanh dương' },
  { hex: '#f59e0b', name: 'Vàng hổ phách' },
  { hex: '#ef4444', name: 'Đỏ san hô' },
  { hex: '#8b5cf6', name: 'Tím thạch anh' },
  { hex: '#64748b', name: 'Xám đá' },
];

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function SignalToggleGroup<T extends string>({
  label,
  tooltip,
  value,
  options,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground" title={tooltip}>
        <span>{label}</span>
        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
      </div>
      <div className="inline-flex rounded-md border border-border bg-background/60 p-0.5">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const THREE_WAY_OPTIONS: readonly SegmentedOption<SignalMode>[] = [
  { value: 'real', label: 'Thật' },
  { value: 'noise', label: 'Nhiễu' },
  { value: 'off', label: 'Tắt' },
];

interface Props {
  form: UseFormReturn<CreateProfileInput>;
  watched: Partial<CreateProfileInput>;
  currentBrowser: BrowserType;
  presets: ProfilePreset[];
  startupUrlsText: string;
  setStartupUrlsText: (v: string) => void;
  onApplyPreset: (preset: ProfilePreset) => void;
  onSaveCustomPreset: (name: string) => Promise<void>;
  onDeleteCustomPreset: (id: string) => Promise<void>;
  markCustomPreset: () => void;
}

export function AdvancedProfileSections({
  form,
  watched,
  currentBrowser,
  presets,
  startupUrlsText,
  setStartupUrlsText,
  onApplyPreset,
  onSaveCustomPreset,
  onDeleteCustomPreset,
  markCustomPreset,
}: Props): React.JSX.Element {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  const caps = getBrowserCapabilities(currentBrowser);
  const signals = normalizeSignals(watched.fingerprint?.signals);
  const mediaDevices = normalizeMediaDevices(watched.mediaDevices);
  const dataOnClose = normalizeDataOnClose(watched.dataOnClose);
  const winCfg = normalizeWindow(watched.window, watched.fingerprint?.screen);
  const bandwidth = normalizeBandwidth(watched.bandwidth);
  const behavior = normalizeBehavior(watched.behavior);
  const meta = normalizeMeta(watched.meta, watched.notes ?? '');
  const currentPresetId = watched.presetId || 'balanced';
  const activePreset = presets.find((p) => p.id === currentPresetId);

  const updateSignal = <K extends keyof ProfileSignals>(key: K, val: ProfileSignals[K]): void => {
    form.setValue('fingerprint.signals', { ...signals, [key]: val });
    markCustomPreset();
  };

  const updateMedia = (patch: Partial<typeof mediaDevices>): void => {
    form.setValue('mediaDevices', { ...mediaDevices, ...patch });
    markCustomPreset();
  };

  const updateBehavior = (patch: Partial<typeof behavior>): void => {
    form.setValue('behavior', { ...behavior, ...patch });
    markCustomPreset();
  };

  const updateBandwidth = (patch: Partial<typeof bandwidth>): void => {
    form.setValue('bandwidth', { ...bandwidth, ...patch });
    markCustomPreset();
  };

  const updateDataOnClose = (patch: Partial<typeof dataOnClose>): void => {
    form.setValue('dataOnClose', { ...dataOnClose, ...patch });
    markCustomPreset();
  };

  const updateWindow = (patch: Partial<typeof winCfg>): void => {
    form.setValue('window', { ...winCfg, ...patch });
  };

  const updateMeta = (patch: Partial<typeof meta>): void => {
    const next = { ...meta, ...patch };
    form.setValue('meta', next);
    if (patch.notes !== undefined) {
      form.setValue('notes', patch.notes);
    }
  };

  const handleSavePresetClick = async (): Promise<void> => {
    if (!newPresetName.trim()) return;
    setSavingPreset(true);
    try {
      await onSaveCustomPreset(newPresetName.trim());
      setNewPresetName('');
    } finally {
      setSavingPreset(false);
    }
  };

  return (
    <>
      {/* 5. Fingerprint & Presets */}
      <Card id="sec-fingerprint" className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Dấu vân tay</h3>
            <Badge
              variant={currentPresetId === 'custom' ? 'secondary' : 'default'}
              className="text-[11px]"
            >
              {activePreset ? activePreset.name : 'Tùy chỉnh'}
            </Badge>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              form.setValue('fingerprint.signals', { ...DEFAULT_SIGNALS });
              form.setValue('mediaDevices', { ...DEFAULT_MEDIA_DEVICES });
              form.setValue('fingerprint.webrtc', 'replace');
              markCustomPreset();
            }}
          >
            <RotateCcw className="h-3 w-3" />
            Đặt lại mặc định
          </Button>
        </div>

        {/* Preset bar */}
        <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">Bộ cấu hình mẫu (Preset)</span>
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="Tên preset mới..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="h-7 w-40 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={savingPreset || !newPresetName.trim()}
                onClick={() => void handleSavePresetClick()}
              >
                <Save className="h-3 w-3" />
                Lưu preset riêng
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {presets.map((preset) => {
              const selected = currentPresetId === preset.id;
              return (
                <div
                  key={preset.id}
                  className={cn(
                    'flex items-start justify-between gap-2 rounded-lg border p-2.5 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card/50 hover:border-primary/40',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onApplyPreset(preset)}
                  >
                    <div className="text-xs font-semibold text-foreground">{preset.name}</div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {preset.description}
                    </p>
                  </button>
                  {!preset.builtIn && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-destructive"
                      onClick={() => void onDeleteCustomPreset(preset.id)}
                      title="Xóa preset riêng"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Signal controls */}
        <div className="grid gap-2">
          <SignalToggleGroup
            label="Canvas 2D"
            tooltip="Thật: không can thiệp. Nhiễu: thêm nhiễu cố định theo seed của hồ sơ. Tắt: trả ảnh trống (dễ bị đánh dấu bất thường)."
            value={signals.canvas}
            options={THREE_WAY_OPTIONS}
            onChange={(v) => updateSignal('canvas', v)}
          />
          <SignalToggleGroup
            label="WebGL"
            tooltip="Thật: giữ nguyên. Nhiễu: thêm nhiễu ổn định vào readPixels. Tắt: trả null khi gọi getContext('webgl') (cảnh báo trên máy có GPU)."
            value={signals.webgl}
            options={THREE_WAY_OPTIONS}
            onChange={(v) => updateSignal('webgl', v)}
          />
          <SignalToggleGroup
            label="WebGL Metadata (Vendor/Renderer)"
            tooltip="Tùy chỉnh: báo cáo GPU theo thiết bị giả lập. Thật: báo cáo GPU vật lý của máy bạn."
            value={signals.webglMetadata}
            options={[
              { value: 'custom', label: 'Tùy chỉnh' },
              { value: 'real', label: 'Thật' },
            ]}
            onChange={(v) => updateSignal('webglMetadata', v)}
          />
          <SignalToggleGroup
            label="AudioContext"
            tooltip="Thật: không can thiệp. Nhiễu: nhiễu nhỏ cố định theo seed. Tắt: trả tín hiệu 0 tuyệt đối."
            value={signals.audio}
            options={THREE_WAY_OPTIONS}
            onChange={(v) => updateSignal('audio', v)}
          />
          <SignalToggleGroup
            label="ClientRects"
            tooltip="Nhiễu: lệch sub-pixel ổn định theo seed để tránh định danh qua kích thước phần tử DOM."
            value={signals.clientRects}
            options={[
              { value: 'real', label: 'Thật' },
              { value: 'noise', label: 'Nhiễu' },
            ]}
            onChange={(v) => updateSignal('clientRects', v)}
          />
          <SignalToggleGroup
            label="Fonts"
            tooltip="Tùy chỉnh: lọc kiểm tra font theo danh sách font của hệ điều hành giả lập. Thật: dùng toàn bộ font máy chủ."
            value={signals.fonts}
            options={[
              { value: 'real', label: 'Thật' },
              { value: 'custom', label: 'Tùy chỉnh' },
            ]}
            onChange={(v) => updateSignal('fonts', v)}
          />
          <SignalToggleGroup
            label="Speech Voices"
            tooltip="Tùy chỉnh: trả danh sách giọng đọc khớp OS giả lập. Tắt: trả mảng rỗng. Thật: dùng giọng hệ thống."
            value={signals.speechVoices}
            options={[
              { value: 'real', label: 'Thật' },
              { value: 'custom', label: 'Tùy chỉnh' },
              { value: 'off', label: 'Tắt' },
            ]}
            onChange={(v) => updateSignal('speechVoices', v)}
          />
          {caps.batterySignal && (
            <SignalToggleGroup
              label="Battery API"
              tooltip="Tắt: trả mức pin tĩnh 100% đang sạc để tránh bị định danh theo phần trăm pin thật. Thật: báo pin thật."
              value={signals.battery}
              options={[
                { value: 'real', label: 'Thật' },
                { value: 'off', label: 'Tắt' },
              ]}
              onChange={(v) => updateSignal('battery', v)}
            />
          )}
          <label
            className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs"
            title="Chặn trang web bên ngoài quét cổng localhost/LAN (127.0.0.1, 192.168.x.x)."
          >
            <span className="flex items-center gap-1.5 font-medium">
              Chống quét cổng cục bộ (Port Scan Protect)
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <input
              type="checkbox"
              checked={signals.portScanProtect}
              onChange={(e) => updateSignal('portScanProtect', e.target.checked)}
            />
          </label>
        </div>

        {/* Media Devices */}
        <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Thiết bị Media (Camera / Mic / Loa)</span>
            <div className="inline-flex rounded-md border border-border bg-background/60 p-0.5">
              {(['fake', 'real'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateMedia({ mode: m })}
                  className={cn(
                    'rounded px-2.5 py-0.5 text-[11px] font-medium',
                    mediaDevices.mode === m
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {m === 'fake' ? 'Giả lập' : 'Thật'}
                </button>
              ))}
            </div>
          </div>
          {mediaDevices.mode === 'fake' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Camera</label>
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={mediaDevices.cameras}
                  onChange={(e) => updateMedia({ cameras: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Micro</label>
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={mediaDevices.microphones}
                  onChange={(e) => updateMedia({ microphones: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Loa</label>
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={mediaDevices.speakers}
                  onChange={(e) => updateMedia({ speakers: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Screen, Hardware, WebRTC, WebGL metadata */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Width</label>
            <Input
              type="number"
              {...form.register('fingerprint.screen.width', { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Height</label>
            <Input
              type="number"
              {...form.register('fingerprint.screen.height', { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">DPR</label>
            <Input
              type="number"
              step="0.25"
              {...form.register('fingerprint.screen.dpr', { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">CPU Cores</label>
            <Input
              type="number"
              {...form.register('fingerprint.hardware.cores', { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">RAM (GB)</label>
            <Input
              type="number"
              {...form.register('fingerprint.hardware.memory', { valueAsNumber: true })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">WebRTC</label>
            <Select
              value={watched.fingerprint?.webrtc ?? 'replace'}
              onChange={(e) => {
                form.setValue(
                  'fingerprint.webrtc',
                  e.target.value as CreateProfileInput['fingerprint']['webrtc'],
                );
                markCustomPreset();
              }}
            >
              <option value="replace">Replace (Chỉ lộ IP proxy)</option>
              <option value="disable">Disable (Tắt hoàn toàn)</option>
              <option value="real">Real (Không ẩn)</option>
            </Select>
          </div>
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs text-muted-foreground">WebGL Vendor</label>
            <Input {...form.register('fingerprint.webgl.vendor')} />
          </div>
          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs text-muted-foreground">WebGL Renderer</label>
            <Input {...form.register('fingerprint.webgl.renderer')} />
          </div>
        </div>
      </Card>

      {/* 6. Browser Behavior */}
      <Card id="sec-behavior" className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Hành vi trình duyệt</h3>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              form.setValue('behavior', { ...DEFAULT_BEHAVIOR });
              markCustomPreset();
            }}
          >
            <RotateCcw className="h-3 w-3" />
            Đặt lại mặc định
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Thông báo (Notifications)</label>
            <Select
              value={behavior.notifications}
              onChange={(e) =>
                updateBehavior({ notifications: e.target.value as 'ask' | 'block' })
              }
            >
              <option value="block">Chặn mặc định</option>
              <option value="ask">Hỏi người dùng</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Hỏi quyền vị trí (Geolocation)
            </label>
            <Select
              value={behavior.geolocationPrompt}
              onChange={(e) =>
                updateBehavior({
                  geolocationPrompt: e.target.value as 'ask' | 'allow' | 'block',
                })
              }
            >
              <option value="allow">Cho phép (theo tọa độ hồ sơ)</option>
              <option value="ask">Hỏi mỗi lần</option>
              <option value="block">Chặn hoàn toàn</option>
            </Select>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={behavior.doNotTrack}
              onChange={(e) => updateBehavior({ doNotTrack: e.target.checked })}
            />
            Bật Do Not Track (DNT: 1)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={behavior.hardwareAcceleration}
              onChange={(e) => updateBehavior({ hardwareAcceleration: e.target.checked })}
            />
            Tăng tốc phần cứng (GPU)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={behavior.disableAutofill}
              onChange={(e) => updateBehavior({ disableAutofill: e.target.checked })}
            />
            Tắt tự động điền mật khẩu / biểu mẫu
          </label>
          {caps.disableGoogleSync && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={behavior.disableGoogleSync}
                onChange={(e) => updateBehavior({ disableGoogleSync: e.target.checked })}
              />
              Tắt Google Sync (chỉ Chromium)
            </label>
          )}
        </div>
      </Card>

      {/* 7. Startup */}
      <Card id="sec-startup" className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Khởi động</h3>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setStartupUrlsText('');
              form.setValue('startup', { urls: [], restoreTabs: false, bookmarks: [], extensions: [] });
            }}
          >
            <RotateCcw className="h-3 w-3" />
            Đặt lại mặc định
          </Button>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Trang mở khi khởi chạy (mỗi dòng 1 URL)
          </label>
          <Textarea
            rows={3}
            value={startupUrlsText}
            onChange={(e) => setStartupUrlsText(e.target.value)}
            placeholder="https://browserleaks.com/webrtc"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-foreground">
          <input type="checkbox" {...form.register('startup.restoreTabs')} />
          Khôi phục các tab từ phiên trước
        </label>

        {caps.chromeExtensions && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Thư mục Extension giải nén (chỉ Chromium, mỗi dòng 1 đường dẫn)
            </label>
            <Textarea
              rows={2}
              value={(watched.startup?.extensions ?? []).join('\n')}
              onChange={(e) =>
                form.setValue(
                  'startup.extensions',
                  e.target.value
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="C:\extensions\my-unpacked-ext"
              className="font-mono text-xs"
            />
          </div>
        )}
      </Card>

      {/* 8. Bandwidth */}
      <Card id="sec-bandwidth" className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Băng thông</h3>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              form.setValue('bandwidth', { ...DEFAULT_BANDWIDTH });
              markCustomPreset();
            }}
          >
            <RotateCcw className="h-3 w-3" />
            Đặt lại mặc định
          </Button>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={bandwidth.blockImages}
              onChange={(e) => updateBandwidth({ blockImages: e.target.checked })}
            />
            Chặn tải hình ảnh (Images)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={bandwidth.blockMedia}
              onChange={(e) => updateBandwidth({ blockMedia: e.target.checked })}
            />
            Chặn video / âm thanh (Media)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={bandwidth.blockExternalFonts}
              onChange={(e) => updateBandwidth({ blockExternalFonts: e.target.checked })}
            />
            Chặn font ngoài (External Fonts)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={bandwidth.blockAds}
              onChange={(e) => updateBandwidth({ blockAds: e.target.checked })}
            />
            Chặn tên miền quảng cáo (Ads)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={bandwidth.blockTrackers}
              onChange={(e) => updateBandwidth({ blockTrackers: e.target.checked })}
            />
            Chặn tên miền theo dõi (Trackers)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={bandwidth.cacheStaticResources}
              onChange={(e) => updateBandwidth({ cacheStaticResources: e.target.checked })}
            />
            Lưu cache tài nguyên tĩnh theo hồ sơ
          </label>
        </div>
      </Card>

      {/* 9. Advanced (collapsed by default) */}
      <Card id="sec-advanced" className="p-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            {advancedOpen ? (
              <ChevronDown className="h-4 w-4 text-primary" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Sliders className="h-4 w-4 text-primary" />
            <span>Nâng cao (Cửa sổ, Dọn dữ liệu khi đóng, Ghi chú & Nhãn màu)</span>
          </button>
          {advancedOpen && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                form.setValue('window', { ...DEFAULT_WINDOW });
                form.setValue('dataOnClose', { ...DEFAULT_DATA_ON_CLOSE });
                form.setValue('meta', { ...DEFAULT_META });
                form.setValue('notes', '');
                markCustomPreset();
              }}
            >
              <RotateCcw className="h-3 w-3" />
              Đặt lại mặc định
            </Button>
          )}
        </div>

        {advancedOpen && (
          <div className="mt-4 space-y-4 border-t border-border pt-4">
            {/* Window sizing */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground">Kích thước & vị trí cửa sổ</h4>
              <div className="grid gap-2 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Rộng (px)</label>
                  <Input
                    type="number"
                    value={winCfg.width}
                    onChange={(e) => updateWindow({ width: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Cao (px)</label>
                  <Input
                    type="number"
                    value={winCfg.height}
                    onChange={(e) => updateWindow({ height: Number(e.target.value) })}
                  />
                </div>
                {caps.windowPosition && (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        Vị trí X
                      </label>
                      <Input
                        type="number"
                        placeholder="Auto"
                        value={winCfg.x ?? ''}
                        onChange={(e) =>
                          updateWindow({ x: e.target.value === '' ? null : Number(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">
                        Vị trí Y
                      </label>
                      <Input
                        type="number"
                        placeholder="Auto"
                        value={winCfg.y ?? ''}
                        onChange={(e) =>
                          updateWindow({ y: e.target.value === '' ? null : Number(e.target.value) })
                        }
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={winCfg.randomizeSlightly}
                    onChange={(e) => updateWindow({ randomizeSlightly: e.target.checked })}
                  />
                  Lệch ngẫu nhiên vài pixel theo seed
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={winCfg.maximized}
                    onChange={(e) => updateWindow({ maximized: e.target.checked })}
                  />
                  Phóng to toàn màn hình khi mở
                </label>
              </div>
            </div>

            {/* Data on close */}
            <div className="space-y-2 border-t border-border pt-3">
              <h4 className="text-xs font-semibold text-foreground">
                Tự động dọn dữ liệu khi đóng hồ sơ
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={dataOnClose.clearCookies}
                    onChange={(e) => updateDataOnClose({ clearCookies: e.target.checked })}
                  />
                  Xóa Cookies
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={dataOnClose.clearCache}
                    onChange={(e) => updateDataOnClose({ clearCache: e.target.checked })}
                  />
                  Xóa Cache
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={dataOnClose.clearHistory}
                    onChange={(e) => updateDataOnClose({ clearHistory: e.target.checked })}
                  />
                  Xóa Lịch sử duyệt web
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={dataOnClose.clearLocalStorage}
                    onChange={(e) => updateDataOnClose({ clearLocalStorage: e.target.checked })}
                  />
                  Xóa LocalStorage / IndexedDB
                </label>
              </div>
            </div>

            {/* Meta: notes, color, expiresAt */}
            <div className="space-y-3 border-t border-border pt-3">
              <h4 className="text-xs font-semibold text-foreground">
                Ghi chú, màu nhãn & ngày hết hạn
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11px] text-muted-foreground">Màu nhãn</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {LABEL_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        title={c.name}
                        onClick={() => updateMeta({ color: c.hex })}
                        className={cn(
                          'h-6 w-6 rounded-full border-2 transition-transform',
                          meta.color === c.hex
                            ? 'scale-110 border-foreground'
                            : 'border-transparent opacity-75 hover:opacity-100',
                        )}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Ngày hết hạn (tùy chọn)
                  </label>
                  <Input
                    type="date"
                    value={meta.expiresAt ? meta.expiresAt.slice(0, 10) : ''}
                    onChange={(e) =>
                      updateMeta({ expiresAt: e.target.value ? e.target.value : null })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Ghi chú</label>
                <Textarea
                  rows={3}
                  value={meta.notes}
                  onChange={(e) => updateMeta({ notes: e.target.value })}
                  placeholder="Ghi chú tài khoản, mục đích sử dụng..."
                />
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
