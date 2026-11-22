import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Dices,
  Download,
  Fingerprint,
  Gauge,
  Globe,
  Info,
  Laptop,
  Loader2,
  MapPin,
  Monitor,
  Play,
  Rocket,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Terminal,
  User,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AdvancedProfileSections } from '@/components/AdvancedProfileSections';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import {
  checkIdentityConsistency,
  inferLanguageFromCountry,
  parseQuickProxyDetailed,
  profileFormSchema,
} from '@shared/validation';
import type {
  BrowserType,
  CreateProfileInput,
  EmulatedDevice,
  EmulationConfidence,
  ManagedBrowserVersion,
  Platform,
  ProfilePreset,
  ProxyCheckResult,
  ProxyLeakCheckResult,
} from '@shared/types';
import {
  normalizeBandwidth,
  normalizeBehavior,
  normalizeDataOnClose,
  normalizeMediaDevices,
  normalizeSignals,
} from '@shared/advancedDefaults';

type SectionId =
  | 'identity'
  | 'environment'
  | 'geo'
  | 'proxy'
  | 'fingerprint'
  | 'behavior'
  | 'startup'
  | 'bandwidth'
  | 'advanced';

const DEFAULT_VALUES: CreateProfileInput = {
  name: 'Essie Crooks',
  folderId: null,
  status: 'none',
  tags: [],
  notes: '',
  platform: 'windows',
  osVersion: 'Windows 11',
  browser: 'chrome',
  browserVersion: '131.0.6778.204',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.204 Safari/537.36',
  proxy: { type: 'none', host: '', port: 0, username: '', password: '' },
  ipv6Policy: 'block',
  geo: { mode: 'auto', timezone: 'Asia/Ho_Chi_Minh', language: 'vi-VN', lat: null, lon: null },
  fingerprint: {
    screen: { width: 1920, height: 1080, dpr: 1 },
    hardware: { cores: 8, memory: 16 },
    webgl: {
      vendor: 'Google Inc. (NVIDIA)',
      renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
    canvasNoiseSeed: 481293,
    audioNoiseSeed: 912341,
    fonts: ['Segoe UI', 'Arial', 'Calibri', 'Consolas', 'Tahoma', 'Verdana'],
    webrtc: 'replace',
  },
  startup: { urls: [], restoreTabs: false },
};

const RANDOM_NAMES = [
  'Essie Crooks',
  'Liam Carter',
  'Ava Bennett',
  'Noah Parker',
  'Chloe Morgan',
  'Lucas Hayes',
  'Sophia Reed',
  'Ethan Collins',
  'Harper Brooks',
  'Oliver Ward',
];

export function ProfileFormPage(): React.JSX.Element {
  const { locale, editingProfileId, folders, proxies, setActivePage, refreshProfiles, showToast } =
    useAppStore();
  const dict = getTranslations(locale);

  const [activeSection, setActiveSection] = useState<SectionId>('identity');
  const [tagsText, setTagsText] = useState('');
  const [startupUrlsText, setStartupUrlsText] = useState('');
  const [quickProxyText, setQuickProxyText] = useState('');
  const [checkingProxy, setCheckingProxy] = useState(false);
  const [proxyCheck, setProxyCheck] = useState<ProxyCheckResult | null>(null);
  const [checkingLeak, setCheckingLeak] = useState(false);
  const [leakResult, setLeakResult] = useState<ProxyLeakCheckResult | null>(null);
  const [autoMatchedGeo, setAutoMatchedGeo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [devices, setDevices] = useState<EmulatedDevice[]>([]);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [managedBrowsers, setManagedBrowsers] = useState<ManagedBrowserVersion[]>([]);
  const [confidence, setConfidence] = useState<EmulationConfidence | null>(null);
  const [presets, setPresets] = useState<ProfilePreset[]>([]);

  const form = useForm<CreateProfileInput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const watched = useWatch({ control: form.control });

  const getDefaultRealVersion = (
    browser: BrowserType,
    installedList: ManagedBrowserVersion[] = managedBrowsers,
  ): string => {
    const match = installedList.find((b) => b.installed && b.browserKind === browser);
    if (match?.version && /^\d+/.test(match.version)) {
      return match.version;
    }
    return form.getValues('browserVersion') || '136.0.0.0';
  };

  const applyDeviceSelection = async (
    deviceId: string,
    overrideVersion?: string,
  ): Promise<void> => {
    if (!window.electronAPI) return;
    const current = form.getValues();
    const version = overrideVersion ?? getDefaultRealVersion(current.browser);
    const applied = await window.electronAPI.applyEmulatedDevice(current, deviceId, version);
    form.setValue('platform', applied.platform);
    form.setValue('osVersion', applied.osVersion);
    form.setValue('deviceId', applied.deviceId ?? null);
    form.setValue('deviceLabel', applied.deviceLabel ?? '');
    form.setValue('browser', applied.browser);
    form.setValue('browserVersion', applied.browserVersion);
    form.setValue('userAgent', applied.userAgent);
    form.setValue('fingerprint', applied.fingerprint);
  };

  const handleSelectPlatform = async (platform: Platform): Promise<void> => {
    if (!window.electronAPI) return;
    const randomDev = await window.electronAPI.pickRandomDevice(platform);
    const currentBrowser = form.getValues('browser');
    const targetBrowser: BrowserType =
      platform === 'android'
        ? 'chrome'
        : platform === 'ios'
          ? currentBrowser === 'webkit'
            ? 'webkit'
            : 'chrome'
          : currentBrowser === 'webkit'
            ? 'chrome'
            : currentBrowser;
    form.setValue('browser', targetBrowser);
    await applyDeviceSelection(randomDev.id, getDefaultRealVersion(targetBrowser));
  };

  const handleRandomDevice = async (): Promise<void> => {
    if (!window.electronAPI) return;
    const platform = form.getValues('platform');
    const randomDev = await window.electronAPI.pickRandomDevice(platform);
    await applyDeviceSelection(randomDev.id);
    showToast(`Đã chọn thiết bị: ${randomDev.label}`, 'info');
  };

  const handleSelectBrowserVersion = async (version: string): Promise<void> => {
    form.setValue('browserVersion', version);
    const currentDeviceId = form.getValues('deviceId');
    if (currentDeviceId && window.electronAPI) {
      await applyDeviceSelection(currentDeviceId, version);
      return;
    }
    const ua = form.getValues('userAgent');
    const platform = form.getValues('platform');
    const browser = form.getValues('browser');
    if (platform !== 'ios' && ua !== 'auto') {
      if (browser === 'firefox') {
        const major = version.split('.')[0] ?? '136';
        form.setValue(
          'userAgent',
          ua.replace(/rv:\d+\.\d+/i, `rv:${major}.0`).replace(/Firefox\/\d+\.\d+/i, `Firefox/${major}.0`),
        );
      } else {
        form.setValue('userAgent', ua.replace(/Chrome\/\d+(?:\.\d+)*/i, `Chrome/${version}`));
      }
    }
  };

  const applyGeneratedIdentity = async (
    platform: Platform,
    browser: BrowserType,
  ): Promise<void> => {
    if (!window.electronAPI) return;
    if (platform === 'android' || platform === 'ios') {
      await handleSelectPlatform(platform);
      return;
    }
    const generated = await window.electronAPI.generateFingerprint(platform, browser);
    const realVersion = getDefaultRealVersion(browser);
    form.setValue('platform', generated.platform);
    form.setValue('osVersion', generated.osVersion);
    form.setValue('browser', generated.browser);
    form.setValue('browserVersion', realVersion);
    const alignedUa =
      browser === 'firefox'
        ? generated.userAgent
            .replace(/rv:\d+\.\d+/i, `rv:${realVersion.split('.')[0] ?? '136'}.0`)
            .replace(/Firefox\/\d+\.\d+/i, `Firefox/${realVersion.split('.')[0] ?? '136'}.0`)
        : generated.userAgent.replace(/Chrome\/\d+(?:\.\d+)*/i, `Chrome/${realVersion}`);
    form.setValue('userAgent', alignedUa);
    form.setValue('fingerprint', generated.fingerprint);
  };

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      if (!window.electronAPI) return;
      const [allDevs, installedBrowsers, allPresets] = await Promise.all([
        window.electronAPI.listEmulatedDevices(),
        window.electronAPI.listManagedBrowsers(),
        window.electronAPI.listPresets(),
      ]);
      if (active) {
        setDevices(allDevs);
        setManagedBrowsers(installedBrowsers);
        setPresets(allPresets);
      }
      const defaultChromeVer =
        installedBrowsers.find((b) => b.installed && b.browserKind === 'chrome')?.version ||
        '136.0.0.0';

      if (editingProfileId) {
        const existing = await window.electronAPI.getProfile(editingProfileId);
        if (existing && active) {
          form.reset({
            name: existing.name,
            folderId: existing.folderId,
            status: existing.status,
            tags: existing.tags,
            notes: existing.notes,
            platform: existing.platform,
            osVersion: existing.osVersion,
            deviceId: existing.deviceId ?? null,
            deviceLabel: existing.deviceLabel ?? '',
            browser: existing.browser,
            browserVersion: existing.browserVersion,
            lastBrowserVersion: existing.lastBrowserVersion ?? null,
            userAgent: existing.userAgent,
            proxy: existing.proxy,
            ipv6Policy: existing.ipv6Policy ?? 'block',
            geo: existing.geo,
            fingerprint: existing.fingerprint,
            startup: existing.startup,
            mediaDevices: existing.mediaDevices,
            dataOnClose: existing.dataOnClose,
            window: existing.window,
            bandwidth: existing.bandwidth,
            behavior: existing.behavior,
            meta: existing.meta,
            presetId: existing.presetId ?? 'balanced',
          });
          setTagsText(existing.tags.join(', '));
          setStartupUrlsText(existing.startup.urls.join('\n'));
        }
      } else {
        const name =
          RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ?? 'Essie Crooks';
        const base: CreateProfileInput = { ...DEFAULT_VALUES, name, browserVersion: defaultChromeVer };
        const picked = await window.electronAPI.pickRandomDevice('windows');
        const applied = await window.electronAPI.applyEmulatedDevice(base, picked.id, defaultChromeVer);
        if (active) {
          form.reset(applied);
          setTagsText('');
          setStartupUrlsText('');
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [editingProfileId, form]);

  useEffect(() => {
    let active = true;
    const plat = watched.platform ?? 'windows';
    const br = watched.browser ?? 'chrome';
    if (!window.electronAPI) return;
    void window.electronAPI.getEmulationConfidence(plat, br).then((res) => {
      if (active) setConfidence(res);
    });
    return () => {
      active = false;
    };
  }, [watched.platform, watched.browser]);

  const identityReport = useMemo(() => {
    const current = form.getValues();
    const matchedInstalled = managedBrowsers.find(
      (b) => b.installed && b.browserKind === current.browser && b.version === current.browserVersion,
    );
    const fallbackInstalled = managedBrowsers.find(
      (b) => b.installed && b.browserKind === current.browser,
    );
    const realEngineVersion = matchedInstalled?.version ?? fallbackInstalled?.version;
    return checkIdentityConsistency(current, proxyCheck, {
      realEngineVersion,
      browser: current.browser,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, proxyCheck, managedBrowsers]);

  const handleCheckProxy = async (): Promise<void> => {
    if (!window.electronAPI) return;
    setCheckingProxy(true);
    try {
      const proxy = form.getValues('proxy');
      const res = await window.electronAPI.checkProxy(proxy);
      setProxyCheck(res);
      if (res.ok && form.getValues('geo.mode') === 'auto') {
        form.setValue('geo.timezone', res.timezone);
        form.setValue('geo.language', res.language);
        form.setValue('geo.lat', res.lat);
        form.setValue('geo.lon', res.lon);
        setAutoMatchedGeo(true);
      } else {
        setAutoMatchedGeo(false);
      }
    } finally {
      setCheckingProxy(false);
    }
  };

  const handleAutoFix = async (): Promise<void> => {
    const current = form.getValues();
    await applyGeneratedIdentity(current.platform, current.browser);
    if (current.proxy.type !== 'none') {
      form.setValue('fingerprint.webrtc', 'replace');
    }
    if (proxyCheck && proxyCheck.ok) {
      form.setValue('geo.mode', 'auto');
      form.setValue('geo.timezone', proxyCheck.timezone);
      form.setValue('geo.language', inferLanguageFromCountry(proxyCheck.countryCode));
      form.setValue('geo.lat', proxyCheck.lat);
      form.setValue('geo.lon', proxyCheck.lon);
    }
    showToast('Đã tự động đồng bộ cấu hình nhất quán', 'success');
  };

  const handleCheckLeak = async (): Promise<void> => {
    if (!window.electronAPI) return;
    setCheckingLeak(true);
    try {
      const proxy = form.getValues('proxy');
      const ipv6Policy = form.getValues('ipv6Policy');
      const res = await window.electronAPI.checkProxyLeak(proxy, proxyCheck?.ip, ipv6Policy);
      setLeakResult(res);
    } finally {
      setCheckingLeak(false);
    }
  };

  const handleQuickProxyApply = (): void => {
    const parsed = parseQuickProxyDetailed(quickProxyText, 'http');
    if (!parsed.ok) {
      showToast(parsed.error, 'error');
      return;
    }
    form.setValue('proxy', parsed.proxy);
    if (parsed.proxy.type !== 'none') {
      form.setValue('fingerprint.webrtc', 'replace');
    }
    showToast('Đã áp dụng proxy', 'success');
  };

  const saveProfile = async (runAfterSave: boolean): Promise<void> => {
    if (!window.electronAPI) return;

    // Sanitize numeric fields that may become NaN when cleared in HTML number inputs
    const currentRaw = form.getValues();
    if (currentRaw.proxy.type === 'none') {
      form.setValue('proxy.port', 0);
      form.setValue('proxy.host', '');
    } else if (!Number.isFinite(currentRaw.proxy.port)) {
      form.setValue('proxy.port', 0);
    }
    if (!Number.isFinite(currentRaw.fingerprint.screen.width)) {
      form.setValue('fingerprint.screen.width', 1920);
    }
    if (!Number.isFinite(currentRaw.fingerprint.screen.height)) {
      form.setValue('fingerprint.screen.height', 1080);
    }
    if (!Number.isFinite(currentRaw.fingerprint.screen.dpr)) {
      form.setValue('fingerprint.screen.dpr', 1);
    }
    if (!Number.isFinite(currentRaw.fingerprint.hardware.cores)) {
      form.setValue('fingerprint.hardware.cores', 8);
    }
    if (!Number.isFinite(currentRaw.fingerprint.hardware.memory)) {
      form.setValue('fingerprint.hardware.memory', 16);
    }
    if (currentRaw.window) {
      if (!Number.isFinite(currentRaw.window.width)) form.setValue('window.width', 1280);
      if (!Number.isFinite(currentRaw.window.height)) form.setValue('window.height', 800);
      if (currentRaw.window.x !== null && currentRaw.window.x !== undefined && !Number.isFinite(currentRaw.window.x)) {
        form.setValue('window.x', null);
      }
      if (currentRaw.window.y !== null && currentRaw.window.y !== undefined && !Number.isFinite(currentRaw.window.y)) {
        form.setValue('window.y', null);
      }
    }

    const valid = await form.trigger();
    if (!valid) {
      const findFirstError = (obj: unknown, prefix = ''): string | null => {
        if (!obj || typeof obj !== 'object') return null;
        const rec = obj as Record<string, unknown>;
        if (typeof rec['message'] === 'string' && rec['message']) {
          return prefix ? `${prefix}: ${rec['message']}` : rec['message'];
        }
        for (const [k, v] of Object.entries(rec)) {
          const nested = findFirstError(v, prefix ? `${prefix}.${k}` : k);
          if (nested) return nested;
        }
        return null;
      };
      const detail = findFirstError(form.formState.errors);
      showToast(
        detail ? `Lỗi dữ liệu (${detail})` : 'Vui lòng kiểm tra lại các trường bị lỗi',
        'error',
      );
      return;
    }

    setSubmitting(true);
    try {
      const raw = form.getValues();
      const payload: CreateProfileInput = {
        ...raw,
        tags: tagsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        startup: {
          ...raw.startup,
          urls: startupUrlsText
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      };

      let savedId: string;
      if (editingProfileId) {
        const updated = await window.electronAPI.updateProfile({
          ...payload,
          id: editingProfileId,
        });
        savedId = updated.id;
        showToast(`Đã cập nhật hồ sơ "${updated.name}"`, 'success');
      } else {
        const created = await window.electronAPI.createProfile(payload);
        savedId = created.id;
        showToast(`Đã tạo hồ sơ "${created.name}"`, 'success');
      }

      await refreshProfiles();
      setActivePage('profiles');

      if (runAfterSave) {
        try {
          const launchRes = await window.electronAPI.startProfile(savedId);
          if (!launchRes.running && launchRes.error) {
            showToast(`Hồ sơ đã lưu, nhưng chưa mở được trình duyệt: ${launchRes.error}`, 'error');
          }
        } catch (launchErr) {
          showToast(
            `Hồ sơ đã lưu, nhưng lỗi khi khởi chạy trình duyệt: ${launchErr instanceof Error ? launchErr.message : 'Không xác định'}`,
            'error',
          );
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi lưu hồ sơ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const scrollToSection = (id: SectionId): void => {
    setActiveSection(id);
    const el = document.getElementById(`sec-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleApplyPreset = (preset: ProfilePreset): void => {
    form.setValue('presetId', preset.id);
    form.setValue('fingerprint.signals', { ...preset.signals });
    form.setValue('fingerprint.webrtc', preset.webrtc);
    form.setValue('mediaDevices', { ...preset.mediaDevices });
    form.setValue('dataOnClose', { ...preset.dataOnClose });
    form.setValue('bandwidth', { ...preset.bandwidth });
    form.setValue('behavior', { ...preset.behavior });
    showToast(`Đã áp dụng preset "${preset.name}"`, 'success');
  };

  const handleSaveCustomPreset = async (name: string): Promise<void> => {
    if (!window.electronAPI) return;
    const current = form.getValues();
    const created = await window.electronAPI.saveCustomPreset({
      name,
      description: 'Preset tùy chỉnh của người dùng',
      signals: normalizeSignals(current.fingerprint.signals),
      mediaDevices: normalizeMediaDevices(current.mediaDevices),
      webrtc: current.fingerprint.webrtc,
      dataOnClose: normalizeDataOnClose(current.dataOnClose),
      bandwidth: normalizeBandwidth(current.bandwidth),
      behavior: normalizeBehavior(current.behavior),
    });
    const refreshed = await window.electronAPI.listPresets();
    setPresets(refreshed);
    form.setValue('presetId', created.id);
    showToast(`Đã lưu preset "${created.name}"`, 'success');
  };

  const handleDeleteCustomPreset = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteCustomPreset(id);
    const refreshed = await window.electronAPI.listPresets();
    setPresets(refreshed);
    if (form.getValues('presetId') === id) {
      form.setValue('presetId', 'custom');
    }
    showToast('Đã xóa preset tùy chỉnh', 'info');
  };

  const sections: { id: SectionId; label: string; icon: typeof User }[] = [
    { id: 'identity', label: dict.form.secIdentity, icon: User },
    { id: 'environment', label: dict.form.secEnvironment, icon: Monitor },
    { id: 'geo', label: dict.form.secGeo, icon: MapPin },
    { id: 'proxy', label: dict.form.secProxy, icon: Globe },
    { id: 'fingerprint', label: dict.form.secFingerprint, icon: Fingerprint },
    { id: 'behavior', label: 'Hành vi trình duyệt', icon: Shield },
    { id: 'startup', label: dict.form.secStartup, icon: Rocket },
    { id: 'bandwidth', label: 'Băng thông', icon: Gauge },
    { id: 'advanced', label: dict.form.secAdvanced, icon: Sliders },
  ];

  const currentPlatform = watched.platform ?? 'windows';
  const currentBrowser = watched.browser ?? 'chrome';

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="default">
            {editingProfileId ? dict.form.editTitle : dict.form.newTitle}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {watched.name || DEFAULT_VALUES.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void applyGeneratedIdentity(currentPlatform, currentBrowser)}
          >
            <Sparkles className="h-4 w-4" />
            {dict.form.newFingerprint}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setActivePage('profiles')}
          >
            <X className="h-4 w-4" />
            {dict.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => void saveProfile(false)}
          >
            <Save className="h-4 w-4" />
            {editingProfileId ? dict.common.save : dict.common.create}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={submitting}
            onClick={() => void saveProfile(true)}
          >
            <Play className="h-4 w-4" />
            {dict.common.createAndRun}
          </Button>
        </div>
      </div>

      {/* 3-column Facet layout: Left anchor nav | Center form | Right identity checker */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[190px_minmax(0,1fr)_320px]">
        {/* Left anchor menu */}
        <Card className="hidden h-fit flex-col gap-1 p-2 lg:flex">
          {sections.map((sec) => {
            const Icon = sec.icon;
            const active = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => scrollToSection(sec.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </Card>

        {/* Center scrollable form */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {/* 1. Identity */}
          <Card id="sec-identity" className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">{dict.form.secIdentity}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  {dict.form.nameLabel} *
                </label>
                <div className="flex gap-2">
                  <Input {...form.register('name')} />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const next =
                        RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ??
                        'Alex Morgan';
                      form.setValue('name', next);
                    }}
                  >
                    <Dices className="h-4 w-4" />
                    {dict.form.randomName}
                  </Button>
                </div>
                {form.formState.errors.name && (
                  <p className="mt-1 text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  {dict.form.folderLabel}
                </label>
                <Select
                  value={watched.folderId ?? ''}
                  onChange={(e) => form.setValue('folderId', e.target.value || null)}
                >
                  <option value="">{dict.common.none}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  {dict.form.statusLabel}
                </label>
                <Select {...form.register('status')}>
                  <option value="none">Không có trạng thái</option>
                  <option value="ready">Sẵn sàng</option>
                  <option value="warming">Đang nuôi</option>
                  <option value="active">Hoạt động</option>
                  <option value="banned">Bị khóa</option>
                </Select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  {dict.form.tagsLabel}
                </label>
                <Input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="facebook, ads, team-a"
                />
              </div>
            </div>
          </Card>

          {/* 2. Environment */}
          <Card id="sec-environment" className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{dict.form.secEnvironment}</h3>
              {confidence && (
                <div
                  className="inline-flex items-center gap-1.5"
                  title="Giả lập chỉ thay đổi thông tin trình duyệt báo cáo; render canvas, font hệ thống và GPU thật vẫn là của máy bạn."
                >
                  <Badge
                    className={cn(
                      'cursor-help text-[11px]',
                      confidence.level === 'high'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : confidence.level === 'medium'
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-destructive/15 text-destructive',
                    )}
                  >
                    <Info className="mr-1 h-3 w-3" />
                    Độ tin cậy: {confidence.label}
                  </Badge>
                </div>
              )}
            </div>

            {confidence?.osMismatch && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-medium">
                    Hệ điều hành giả lập ({currentPlatform.toUpperCase()}) khác với hệ điều hành máy chủ.
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-200/80">{confidence.reason}</p>
                </div>
              </div>
            )}

            <div>
              <label className="mb-2 block text-xs text-muted-foreground">
                {dict.form.platformLabel} *
              </label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {(
                  [
                    { id: 'windows', label: 'Windows', icon: Monitor },
                    { id: 'macos', label: 'macOS', icon: Laptop },
                    { id: 'linux', label: 'Linux', icon: Terminal },
                    { id: 'android', label: 'Android', icon: Smartphone },
                    { id: 'ios', label: 'iOS', icon: Smartphone },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const selected = currentPlatform === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleSelectPlatform(item.id)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-all',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Emulated Device Picker */}
            <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">
                  Thiết bị giả lập ({devices.filter((d) => d.platform === currentPlatform).length} mẫu)
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={() => void handleRandomDevice()}
                >
                  <Dices className="h-3.5 w-3.5" />
                  Ngẫu nhiên
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                <Input
                  placeholder="Tìm thiết bị..."
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                <Select
                  className="h-8 text-xs"
                  value={watched.deviceId ?? ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      void applyDeviceSelection(e.target.value);
                    }
                  }}
                >
                  <option value="">-- Chọn thiết bị giả lập --</option>
                  {devices
                    .filter(
                      (d) =>
                        d.platform === currentPlatform &&
                        (!deviceSearch.trim() ||
                          d.label.toLowerCase().includes(deviceSearch.trim().toLowerCase()) ||
                          d.gpu.renderer.toLowerCase().includes(deviceSearch.trim().toLowerCase())),
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label} • {d.screen.width}x{d.screen.height} @{d.screen.dpr}x
                      </option>
                    ))}
                </Select>
              </div>
              {watched.deviceLabel && (
                <p className="text-[11px] text-muted-foreground">
                  Đang áp dụng: <span className="font-medium text-foreground">{watched.deviceLabel}</span>
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-xs text-muted-foreground">
                {dict.form.browserLabel} *
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    { id: 'chrome', label: 'Chrome (CDP)' },
                    { id: 'firefox', label: 'Firefox (Camoufox)' },
                  ] as const
                ).map((item) => {
                  const selected = currentBrowser === item.id;
                  const disabled =
                    (currentPlatform === 'android' || currentPlatform === 'ios') &&
                    item.id === 'firefox';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => void applyGeneratedIdentity(currentPlatform, item.id)}
                      className={cn(
                        'rounded-lg border px-4 py-2.5 text-left text-xs font-medium transition-all',
                        disabled && 'cursor-not-allowed opacity-45',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.osVersionLabel}
                </label>
                <Input {...form.register('osVersion')} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    {dict.form.browserVersionLabel} (Nhân thật)
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    onClick={() => setActivePage('settings')}
                  >
                    <Download className="h-3 w-3" />
                    Tải thêm phiên bản
                  </button>
                </div>
                <Select
                  value={watched.browserVersion ?? ''}
                  onChange={(e) => void handleSelectBrowserVersion(e.target.value)}
                >
                  {managedBrowsers
                    .filter((b) => b.installed && b.browserKind === currentBrowser)
                    .map((b) => (
                      <option key={b.id} value={b.version}>
                        {b.browserKind === 'chrome' ? 'Chrome' : 'Firefox'} {b.version} ({b.channel})
                      </option>
                    ))}
                  {watched.browserVersion &&
                    !managedBrowsers.some(
                      (b) =>
                        b.installed &&
                        b.browserKind === currentBrowser &&
                        b.version === watched.browserVersion,
                    ) && (
                      <option value={watched.browserVersion}>
                        {watched.browserVersion} (hiện tại)
                      </option>
                    )}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.userAgentLabel}
                </label>
                <Input {...form.register('userAgent')} className="font-mono text-xs" />
              </div>
            </div>
          </Card>

          {/* 3. Geo */}
          <Card id="sec-geo" className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{dict.form.secGeo}</h3>
              {autoMatchedGeo && watched.geo?.mode === 'auto' && (
                <Badge className="bg-emerald-500/15 text-emerald-400">
                  Đã tự khớp theo IP proxy
                </Badge>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                {dict.form.geoModeLabel}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => form.setValue('geo.mode', 'auto')}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    watched.geo?.mode === 'auto'
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  Tự động theo IP
                </button>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('geo.mode', 'manual');
                    setAutoMatchedGeo(false);
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    watched.geo?.mode === 'manual'
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  Nhập tay
                </button>
              </div>
            </div>

            {watched.geo?.mode === 'manual' &&
              proxyCheck?.ok &&
              proxyCheck.timezone &&
              watched.geo?.timezone &&
              watched.geo.timezone !== proxyCheck.timezone && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    Múi giờ đang chọn ({watched.geo.timezone}) không khớp với múi giờ IP proxy (
                    {proxyCheck.timezone}).
                  </span>
                </div>
              )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.timezoneLabel}
                </label>
                <Input
                  {...form.register('geo.timezone')}
                  disabled={watched.geo?.mode === 'auto'}
                  placeholder="Asia/Ho_Chi_Minh"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.languageLabel}
                </label>
                <Input
                  {...form.register('geo.language')}
                  disabled={watched.geo?.mode === 'auto'}
                  placeholder="vi-VN"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.latLabel}
                </label>
                <Input
                  type="number"
                  step="any"
                  disabled={watched.geo?.mode === 'auto'}
                  value={watched.geo?.lat ?? ''}
                  onChange={(e) =>
                    form.setValue('geo.lat', e.target.value === '' ? null : Number(e.target.value))
                  }
                  placeholder="10.8231"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.lonLabel}
                </label>
                <Input
                  type="number"
                  step="any"
                  disabled={watched.geo?.mode === 'auto'}
                  value={watched.geo?.lon ?? ''}
                  onChange={(e) =>
                    form.setValue('geo.lon', e.target.value === '' ? null : Number(e.target.value))
                  }
                  placeholder="106.6297"
                />
              </div>
            </div>
          </Card>

          {/* 4. Proxy */}
          <Card id="sec-proxy" className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{dict.form.secProxy}</h3>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={checkingProxy}
                onClick={() => void handleCheckProxy()}
              >
                {checkingProxy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
                {checkingProxy ? dict.form.checkingIp : 'Kiểm tra proxy'}
              </Button>
            </div>

            {proxies.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.pickSavedProxy}
                </label>
                <Select
                  defaultValue=""
                  onChange={(e) => {
                    const found = proxies.find((p) => p.id === e.target.value);
                    if (found) {
                      form.setValue('proxy', {
                        type: found.type,
                        host: found.host,
                        port: found.port,
                        username: found.username,
                        password: found.password,
                      });
                    }
                  }}
                >
                  <option value="">-- {dict.form.pickSavedProxy} --</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type.toUpperCase()} {p.host}:{p.port})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={quickProxyText}
                onChange={(e) => setQuickProxyText(e.target.value)}
                placeholder={dict.form.quickPasteProxy}
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleQuickProxyApply}>
                {dict.form.applyProxy}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.proxyType}
                </label>
                <Select {...form.register('proxy.type')}>
                  <option value="none">Không dùng Proxy</option>
                  <optgroup label="Cơ bản">
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks4">SOCKS4</option>
                    <option value="socks5">SOCKS5</option>
                  </optgroup>
                  <optgroup label="Nâng cao">
                    <option value="socks4a">SOCKS4a (DNS qua proxy)</option>
                    <option value="socks5h">SOCKS5h (DNS qua proxy)</option>
                    <option value="ssh">SSH Tunnel</option>
                  </optgroup>
                  <optgroup label="Lõi ngoài (sing-box)">
                    <option value="shadowsocks">Shadowsocks (ss://)</option>
                    <option value="vmess">VMess (vmess://)</option>
                    <option value="vless">VLESS (vless://)</option>
                    <option value="trojan">Trojan (trojan://)</option>
                  </optgroup>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.proxyHost}
                </label>
                <Input {...form.register('proxy.host')} placeholder="127.0.0.1" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.proxyPort}
                </label>
                <Input
                  type="number"
                  {...form.register('proxy.port', { valueAsNumber: true })}
                  placeholder="8080"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.proxyUser}
                </label>
                <Input {...form.register('proxy.username')} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.proxyPass}
                </label>
                <Input type="password" {...form.register('proxy.password')} />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs text-muted-foreground">
                  Chính sách IPv6 (ipv6Policy)
                </label>
                <Select {...form.register('ipv6Policy')}>
                  <option value="block">Chặn IPv6 trực tiếp — Mặc định (block)</option>
                  <option value="proxy-only">Chỉ cho phép IPv6 qua proxy (proxy-only)</option>
                </Select>
              </div>

              {/* Dynamic protocol-specific fields */}
              {watched.proxy?.type === 'ssh' && (
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    SSH Private Key (tùy chọn — thay cho mật khẩu)
                  </label>
                  <Textarea
                    rows={3}
                    {...form.register('proxy.privateKey')}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="font-mono text-xs"
                  />
                </div>
              )}

              {watched.proxy?.type === 'shadowsocks' && (
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Shadowsocks Cipher
                  </label>
                  <Select
                    value={watched.proxy?.extra?.['cipher'] ?? 'aes-256-gcm'}
                    onChange={(e) =>
                      form.setValue('proxy.extra', {
                        ...(form.getValues('proxy.extra') ?? {}),
                        cipher: e.target.value,
                      })
                    }
                  >
                    <option value="aes-256-gcm">aes-256-gcm</option>
                    <option value="aes-128-gcm">aes-128-gcm</option>
                    <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
                    <option value="2022-blake3-aes-256-gcm">2022-blake3-aes-256-gcm</option>
                  </Select>
                </div>
              )}

              {(watched.proxy?.type === 'vmess' || watched.proxy?.type === 'vless') && (
                <>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-muted-foreground">UUID</label>
                    <Input
                      value={watched.proxy?.extra?.['uuid'] ?? ''}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          uuid: e.target.value,
                        })
                      }
                      placeholder="11111111-2222-3333-4444-555555555555"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Network</label>
                    <Select
                      value={watched.proxy?.extra?.['network'] ?? 'tcp'}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          network: e.target.value,
                        })
                      }
                    >
                      <option value="tcp">TCP</option>
                      <option value="ws">WebSocket (ws)</option>
                      <option value="grpc">gRPC</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">TLS</label>
                    <Select
                      value={watched.proxy?.extra?.['tls'] ?? 'none'}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          tls: e.target.value,
                        })
                      }
                    >
                      <option value="none">None</option>
                      <option value="tls">TLS</option>
                      <option value="reality">Reality</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">SNI</label>
                    <Input
                      value={watched.proxy?.extra?.['sni'] ?? ''}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          sni: e.target.value,
                        })
                      }
                      placeholder="example.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Path</label>
                    <Input
                      value={watched.proxy?.extra?.['path'] ?? ''}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          path: e.target.value,
                        })
                      }
                      placeholder="/ws"
                    />
                  </div>
                </>
              )}

              {watched.proxy?.type === 'trojan' && (
                <>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs text-muted-foreground">SNI</label>
                    <Input
                      value={watched.proxy?.extra?.['sni'] ?? ''}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          sni: e.target.value,
                        })
                      }
                      placeholder="trojan.example.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Path</label>
                    <Input
                      value={watched.proxy?.extra?.['path'] ?? ''}
                      onChange={(e) =>
                        form.setValue('proxy.extra', {
                          ...(form.getValues('proxy.extra') ?? {}),
                          path: e.target.value,
                        })
                      }
                      placeholder="/ws"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Multi-hop Proxy Chain editor (up to 3 total hops = primary + 2 chain hops) */}
            {watched.proxy?.type !== 'none' && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">
                    Chuỗi proxy (Chain — tối đa 3 chặng)
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={(watched.proxy?.chain?.length ?? 0) >= 2}
                    onClick={() => {
                      const current = form.getValues('proxy.chain') ?? [];
                      if (current.length >= 2) return;
                      form.setValue('proxy.chain', [
                        ...current,
                        { type: 'socks5', host: '', port: 1080, username: '', password: '' },
                      ]);
                    }}
                  >
                    + Thêm chặng
                  </Button>
                </div>

                {(watched.proxy?.chain ?? []).map((hop, idx) => (
                  <div
                    key={idx}
                    className="grid items-center gap-2 rounded-lg border border-border bg-secondary/30 p-2.5 sm:grid-cols-[110px_1fr_80px_auto]"
                  >
                    <Select
                      value={hop.type}
                      onChange={(e) => {
                        const list = [...(form.getValues('proxy.chain') ?? [])];
                        list[idx] = {
                          ...list[idx]!,
                          type: e.target.value as CreateProfileInput['proxy']['type'],
                        };
                        form.setValue('proxy.chain', list);
                      }}
                    >
                      <option value="socks5">SOCKS5</option>
                      <option value="socks5h">SOCKS5h</option>
                      <option value="http">HTTP</option>
                      <option value="shadowsocks">Shadowsocks</option>
                      <option value="vless">VLESS</option>
                    </Select>
                    <Input
                      value={hop.host}
                      onChange={(e) => {
                        const list = [...(form.getValues('proxy.chain') ?? [])];
                        list[idx] = { ...list[idx]!, host: e.target.value };
                        form.setValue('proxy.chain', list);
                      }}
                      placeholder={`Host chặng ${idx + 2}`}
                    />
                    <Input
                      type="number"
                      value={hop.port}
                      onChange={(e) => {
                        const list = [...(form.getValues('proxy.chain') ?? [])];
                        list[idx] = { ...list[idx]!, port: Number(e.target.value) };
                        form.setValue('proxy.chain', list);
                      }}
                      placeholder="Port"
                    />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.electronAPI) return;
                          const targetHop = form.getValues('proxy.chain')?.[idx];
                          if (!targetHop) return;
                          const r = await window.electronAPI.checkProxy(targetHop);
                          showToast(
                            r.ok
                              ? `Chặng ${idx + 2} OK: ${r.ip} (${r.latencyMs}ms)`
                              : `Chặng ${idx + 2} lỗi: ${r.error ?? 'Unknown'}`,
                            r.ok ? 'success' : 'error',
                          );
                        }}
                      >
                        Test
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          const list = [...(form.getValues('proxy.chain') ?? [])];
                          list.splice(idx, 1);
                          form.setValue('proxy.chain', list);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 5-9. Fingerprint, Behavior, Startup, Bandwidth, Advanced */}
          <AdvancedProfileSections
            form={form}
            watched={watched as Partial<CreateProfileInput>}
            currentBrowser={currentBrowser}
            presets={presets}
            startupUrlsText={startupUrlsText}
            setStartupUrlsText={setStartupUrlsText}
            onApplyPreset={handleApplyPreset}
            onSaveCustomPreset={handleSaveCustomPreset}
            onDeleteCustomPreset={handleDeleteCustomPreset}
            markCustomPreset={() => form.setValue('presetId', 'custom')}
          />
        </div>

        {/* Right panel: "Danh tính này có phù hợp không" */}
        <div className="space-y-4">
          <Card className="space-y-4 bg-sidebar p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {identityReport.ok ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                )}
                <span>{dict.form.identityCheckTitle}</span>
              </div>
              <Badge
                className={cn(
                  identityReport.score >= 85
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : identityReport.score >= 60
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-destructive/20 text-destructive',
                )}
              >
                {identityReport.score}/100
              </Badge>
            </div>

            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={checkingProxy}
                onClick={() => void handleCheckProxy()}
              >
                {checkingProxy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Globe className="h-3.5 w-3.5" />
                )}
                {checkingProxy ? dict.form.checkingIp : dict.form.checkIpBtn}
              </Button>

              {proxyCheck && (
                <div className="mt-3 space-y-1.5 border-t border-border pt-2.5">
                  {proxyCheck.ok ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">IP đầu ra</span>
                        <span className="flex items-center gap-1.5">
                          <span className="max-w-[120px] truncate font-mono text-emerald-400">
                            {proxyCheck.ip}
                          </span>
                          {proxyCheck.ipVersion && (
                            <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
                              IPv{proxyCheck.ipVersion}
                            </Badge>
                          )}
                          {proxyCheck.viaBridge !== undefined && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              {proxyCheck.viaBridge ? 'qua bridge' : 'trực tiếp'}
                            </Badge>
                          )}
                        </span>
                      </div>
                      {proxyCheck.dnsLeakRisk && (
                        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                          <span>
                            Giao thức {proxyCheck.protocolUsed?.toUpperCase()} có thể rò DNS cục bộ.
                            Nên dùng SOCKS5h, SSH hoặc sing-box để phân giải DNS qua proxy.
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Quốc gia</span>
                        <span>
                          {proxyCheck.country} ({proxyCheck.countryCode})
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Thành phố</span>
                        <span>{proxyCheck.city || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Múi giờ</span>
                        <span>{proxyCheck.timezone || '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Độ trễ</span>
                        <span
                          className={cn(
                            'font-mono font-medium',
                            proxyCheck.latencyMs < 1500
                              ? 'text-emerald-400'
                              : proxyCheck.latencyMs < 4000
                                ? 'text-amber-400'
                                : 'text-destructive',
                          )}
                        >
                          {proxyCheck.latencyMs} ms
                        </span>
                      </div>
                      {autoMatchedGeo && watched.geo?.mode === 'auto' && (
                        <p className="pt-1 text-[11px] font-medium text-emerald-400">
                          Đã tự khớp theo IP proxy
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-destructive">{proxyCheck.error}</p>
                  )}
                </div>
              )}

              <div className="mt-2.5 border-t border-border pt-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={checkingLeak}
                  onClick={() => void handleCheckLeak()}
                >
                  {checkingLeak ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  {checkingLeak ? 'Đang kiểm tra rò rỉ...' : 'Kiểm tra rò rỉ IPv6'}
                </Button>

                {leakResult && (
                  <div className="mt-2 space-y-1">
                    {leakResult.ok ? (
                      <>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Browser IPv4</span>
                          <span className="font-mono">{leakResult.ipv4 || '—'}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Browser IPv6</span>
                          <span className="font-mono">{leakResult.ipv6 || 'Không có'}</span>
                        </div>
                        {leakResult.leaked && leakResult.warning && (
                          <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                            <span>{leakResult.warning}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-destructive">{leakResult.error}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Warnings list */}
            {identityReport.warnings.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{dict.form.allGood}</span>
              </div>
            ) : (
              <div className="space-y-2">
                {identityReport.warnings.map((w) => (
                  <div
                    key={w.code}
                    className={cn(
                      'rounded-lg border p-2.5 text-xs',
                      w.severity === 'error'
                        ? 'border-destructive/40 bg-destructive/10 text-red-300'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-200',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div>
                        <p className="font-medium">{w.message}</p>
                        <p className="mt-0.5 text-[11px] opacity-80">{w.suggestion}</p>
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={() => void handleAutoFix()}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {dict.form.autoFixBtn}
                </Button>
              </div>
            )}

            {/* Quick summary */}
            <div className="space-y-1.5 border-t border-border pt-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Hệ điều hành</span>
                <span>{watched.osVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Màn hình</span>
                <span>
                  {watched.fingerprint?.screen?.width}×{watched.fingerprint?.screen?.height} (DPR{' '}
                  {watched.fingerprint?.screen?.dpr})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" /> Phần cứng
                </span>
                <span>
                  {watched.fingerprint?.hardware?.cores} cores /{' '}
                  {watched.fingerprint?.hardware?.memory} GB
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">WebRTC</span>
                <Badge variant="secondary">{watched.fingerprint?.webrtc}</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
