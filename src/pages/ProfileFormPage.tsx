import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Dices,
  Fingerprint,
  Globe,
  Laptop,
  Loader2,
  MapPin,
  Monitor,
  Play,
  Rocket,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sliders,
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
import { cn } from '@/lib/utils';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import {
  checkIdentityConsistency,
  inferLanguageFromCountry,
  parseQuickProxy,
  profileFormSchema,
} from '@shared/validation';
import type { BrowserType, CreateProfileInput, Platform, ProxyCheckResult } from '@shared/types';

type SectionId =
  'identity' | 'environment' | 'geo' | 'proxy' | 'fingerprint' | 'startup' | 'advanced';

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
  const [autoMatchedGeo, setAutoMatchedGeo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateProfileInput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const watched = useWatch({ control: form.control });

  const applyGeneratedIdentity = async (
    platform: Platform,
    browser: BrowserType,
  ): Promise<void> => {
    if (!window.electronAPI) return;
    const generated = await window.electronAPI.generateFingerprint(platform, browser);
    form.setValue('platform', generated.platform);
    form.setValue('osVersion', generated.osVersion);
    form.setValue('browser', generated.browser);
    form.setValue('browserVersion', generated.browserVersion);
    form.setValue('userAgent', generated.userAgent);
    form.setValue('fingerprint', generated.fingerprint);
  };

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      if (!window.electronAPI) return;
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
            browser: existing.browser,
            browserVersion: existing.browserVersion,
            userAgent: existing.userAgent,
            proxy: existing.proxy,
            geo: existing.geo,
            fingerprint: existing.fingerprint,
            startup: existing.startup,
          });
          setTagsText(existing.tags.join(', '));
          setStartupUrlsText(existing.startup.urls.join('\n'));
        }
      } else {
        const name =
          RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ?? 'Essie Crooks';
        form.reset({ ...DEFAULT_VALUES, name });
        setTagsText('');
        setStartupUrlsText('');
        const generated = await window.electronAPI.generateFingerprint('windows', 'chrome');
        if (active) {
          form.setValue('osVersion', generated.osVersion);
          form.setValue('browserVersion', generated.browserVersion);
          form.setValue('userAgent', generated.userAgent);
          form.setValue('fingerprint', generated.fingerprint);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [editingProfileId, form]);

  const identityReport = useMemo(() => {
    const current = form.getValues();
    return checkIdentityConsistency(current, proxyCheck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, proxyCheck]);

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

  const handleQuickProxyApply = (): void => {
    const parsed = parseQuickProxy(quickProxyText, 'http');
    if (!parsed) {
      showToast('Không nhận diện được định dạng proxy', 'error');
      return;
    }
    form.setValue('proxy', parsed);
    if (parsed.type !== 'none') {
      form.setValue('fingerprint.webrtc', 'replace');
    }
    showToast('Đã áp dụng proxy', 'success');
  };

  const saveProfile = async (runAfterSave: boolean): Promise<void> => {
    if (!window.electronAPI) return;
    const valid = await form.trigger();
    if (!valid) {
      showToast('Vui lòng kiểm tra lại các trường bị lỗi', 'error');
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
        await window.electronAPI.startProfile(savedId);
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

  const sections: { id: SectionId; label: string; icon: typeof User }[] = [
    { id: 'identity', label: dict.form.secIdentity, icon: User },
    { id: 'environment', label: dict.form.secEnvironment, icon: Monitor },
    { id: 'geo', label: dict.form.secGeo, icon: MapPin },
    { id: 'proxy', label: dict.form.secProxy, icon: Globe },
    { id: 'fingerprint', label: dict.form.secFingerprint, icon: Fingerprint },
    { id: 'startup', label: dict.form.secStartup, icon: Rocket },
    { id: 'advanced', label: dict.form.secAdvanced, icon: Sliders },
  ];

  const currentPlatform = watched.platform ?? 'windows';
  const currentBrowser = watched.browser ?? 'chrome';

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Hidemium-style top action bar */}
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

      {/* 3-column Hidemium layout: Left anchor nav | Center form | Right identity checker */}
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
            <h3 className="text-sm font-semibold">{dict.form.secEnvironment}</h3>

            <div>
              <label className="mb-2 block text-xs text-muted-foreground">
                {dict.form.platformLabel} *
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    { id: 'windows', label: 'Windows', icon: Monitor },
                    { id: 'macos', label: 'macOS', icon: Laptop },
                    { id: 'linux', label: 'Linux', icon: Terminal },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const selected = currentPlatform === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void applyGeneratedIdentity(item.id, currentBrowser)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-secondary/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
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
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void applyGeneratedIdentity(currentPlatform, item.id)}
                      className={cn(
                        'rounded-lg border px-4 py-2.5 text-left text-xs font-medium transition-all',
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
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.browserVersionLabel}
                </label>
                <Input {...form.register('browserVersion')} />
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
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
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
            </div>
          </Card>

          {/* 5. Fingerprint */}
          <Card id="sec-fingerprint" className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">{dict.form.secFingerprint}</h3>
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
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.webrtcMode}
                </label>
                <Select {...form.register('fingerprint.webrtc')}>
                  <option value="replace">Replace (An toàn)</option>
                  <option value="disable">Disable</option>
                  <option value="real">Real (Không ẩn)</option>
                </Select>
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.webglVendor}
                </label>
                <Input {...form.register('fingerprint.webgl.vendor')} />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {dict.form.webglRenderer}
                </label>
                <Input {...form.register('fingerprint.webgl.renderer')} />
              </div>
            </div>
          </Card>

          {/* 6. Startup & 7. Advanced */}
          <Card id="sec-startup" className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">{dict.form.secStartup}</h3>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {dict.form.startupUrls}
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
              {dict.form.restoreTabs}
            </label>
          </Card>

          <Card id="sec-advanced" className="space-y-3 p-5">
            <h3 className="text-sm font-semibold">{dict.form.secAdvanced}</h3>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {dict.form.notesLabel}
              </label>
              <Textarea rows={3} {...form.register('notes')} />
            </div>
          </Card>
        </div>

        {/* Right panel: Hidemium "Danh tính này có phù hợp không" */}
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
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
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">IP đầu ra</span>
                        <span className="font-mono text-emerald-400">{proxyCheck.ip}</span>
                      </div>
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
