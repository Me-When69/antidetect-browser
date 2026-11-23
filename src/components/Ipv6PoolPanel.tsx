import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  Ipv6PoolStatus,
  Ipv6RoutingCheckResult,
  NetworkInterfaceIpv6Info,
} from '@shared/ipv6Types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/StatusBadge';
import { useAppStore } from '@/store/useAppStore';

export function Ipv6PoolPanel(): React.JSX.Element {
  const { locale, showToast } = useAppStore();
  const isEn = locale === 'en';

  const [interfaces, setInterfaces] = useState<NetworkInterfaceIpv6Info[]>([]);
  const [status, setStatus] = useState<Ipv6PoolStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Editable config fields
  const [ifaceName, setIfaceName] = useState('');
  const [prefix64, setPrefix64] = useState('');
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [maxAddresses, setMaxAddresses] = useState(256);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [autoRotateMinutes, setAutoRotateMinutes] = useState(10);
  const [allocateCount, setAllocateCount] = useState(4);

  // Action states
  const [verifying, setVerifying] = useState(false);
  const [routingResult, setRoutingResult] = useState<Ipv6RoutingCheckResult | null>(null);
  const [allocating, setAllocating] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [cleaningAll, setCleaningAll] = useState(false);
  const [busyAddr, setBusyAddr] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    try {
      const [ifaces, st] = await Promise.all([api.listIpv6Interfaces(), api.getIpv6PoolStatus()]);
      setInterfaces(ifaces);
      setStatus(st);
      setIfaceName(st.config.interfaceName || ifaces[0]?.name || '');
      setPrefix64(st.config.prefix64 || ifaces[0]?.suggestedPrefixes[0] || '');
      setOwnershipConfirmed(st.config.ownershipConfirmed);
      setMaxAddresses(st.config.maxAddresses);
      setAutoRotateEnabled(st.config.autoRotateEnabled);
      setAutoRotateMinutes(st.config.autoRotateIntervalMinutes);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi tải Kho IPv6', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.onIpv6PoolStats((ev) => {
      setStatus((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entries: prev.entries.map((entry) =>
            ev.counts[entry.address] !== undefined
              ? { ...entry, activeConnections: ev.counts[entry.address]! }
              : entry,
          ),
        };
      });
    });
    return unsub;
  }, [loadAll]);

  const handleSaveConfig = async (): Promise<boolean> => {
    const api = window.electronAPI;
    if (!api) return false;
    try {
      await api.updateIpv6PoolConfig({
        interfaceName: ifaceName,
        prefix64,
        ownershipConfirmed,
        maxAddresses: Math.max(1, Math.min(1024, maxAddresses)),
        autoRotateEnabled,
        autoRotateIntervalMinutes: Math.max(10, autoRotateMinutes),
      });
      const st = await api.getIpv6PoolStatus();
      setStatus(st);
      showToast(isEn ? 'IPv6 Pool configuration saved' : 'Đã lưu cấu hình Kho IPv6', 'success');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cấu hình tiền tố không hợp lệ', 'error');
      return false;
    }
  };

  const handleVerifyRouting = async (): Promise<void> => {
    const ok = await handleSaveConfig();
    if (!ok || !window.electronAPI) return;
    setVerifying(true);
    setRoutingResult(null);
    try {
      const res = await window.electronAPI.verifyIpv6PrefixRouting();
      setRoutingResult(res);
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(
        res.ok
          ? isEn
            ? 'Prefix routing verified!'
            : 'Kiểm tra định tuyến /64 thành công!'
          : res.error || (isEn ? 'Routing check failed' : 'Kiểm tra định tuyến thất bại'),
        res.ok ? 'success' : 'error',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi kiểm tra định tuyến', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleAllocate = async (): Promise<void> => {
    if (!window.electronAPI) return;
    setAllocating(true);
    try {
      await window.electronAPI.allocateIpv6PoolAddresses(allocateCount);
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(
        isEn
          ? `Assigned ${allocateCount} IPv6 address(es)`
          : `Đã gán ${allocateCount} địa chỉ IPv6`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi gán địa chỉ IPv6', 'error');
    } finally {
      setAllocating(false);
    }
  };

  const handleCheckHealthAll = async (): Promise<void> => {
    if (!window.electronAPI) return;
    setCheckingAll(true);
    try {
      await window.electronAPI.checkIpv6PoolHealthAll();
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(
        isEn ? 'Health check completed' : 'Đã kiểm tra sống/chết tất cả địa chỉ',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi kiểm tra sống/chết', 'error');
    } finally {
      setCheckingAll(false);
    }
  };

  const handleRotateAll = async (): Promise<void> => {
    if (!window.electronAPI) return;
    const confirmed = window.confirm(
      isEn
        ? 'Rotate ALL IPv6 addresses in the pool? Running profiles will have their connections interrupted.'
        : 'Xác nhận xoay TẤT CẢ địa chỉ IPv6 trong kho? Các hồ sơ đang chạy sẽ bị ngắt kết nối hiện tại.',
    );
    if (!confirmed) return;
    try {
      const res = await window.electronAPI.rotateAllIpv6(true);
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(
        isEn ? `Rotated ${res.rotated} address(es)` : `Đã xoay ${res.rotated} địa chỉ IPv6`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi xoay hàng loạt', 'error');
    }
  };

  const handleRemoveAll = async (): Promise<void> => {
    if (!window.electronAPI) return;
    const confirmed = window.confirm(
      isEn
        ? 'Remove ALL IPv6 addresses assigned by Facet from your network adapter? (Host/system IPv6 addresses will NOT be touched.)'
        : 'Gỡ TẤT CẢ địa chỉ IPv6 do Facet gán khỏi card mạng? (Không ảnh hưởng địa chỉ IPv6 gốc của máy.)',
    );
    if (!confirmed) return;
    setCleaningAll(true);
    try {
      const res = await window.electronAPI.removeAllIpv6PoolAddresses();
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(
        isEn
          ? `Removed ${res.removed} app-assigned address(es)`
          : `Đã gỡ ${res.removed} địa chỉ của app`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi gỡ địa chỉ', 'error');
    } finally {
      setCleaningAll(false);
    }
  };

  const handleRotateProfile = async (profileId: string, address: string): Promise<void> => {
    if (!window.electronAPI) return;
    const confirmed = window.confirm(
      isEn
        ? `Rotate IPv6 ${address} for this profile? Active sessions on this profile will be disconnected.`
        : `Đổi địa chỉ IPv6 ${address} cho hồ sơ này? Nếu hồ sơ đang chạy, các kết nối hiện tại sẽ bị ngắt.`,
    );
    if (!confirmed) return;
    setBusyAddr(address);
    try {
      await window.electronAPI.rotateProfileIpv6(profileId, true);
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(isEn ? 'IPv6 rotated' : 'Đã đổi địa chỉ IPv6 mới', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi đổi IPv6', 'error');
    } finally {
      setBusyAddr(null);
    }
  };

  const handleRemoveSingle = async (address: string): Promise<void> => {
    if (!window.electronAPI) return;
    setBusyAddr(address);
    try {
      await window.electronAPI.removeIpv6PoolAddress(address);
      const st = await window.electronAPI.getIpv6PoolStatus();
      setStatus(st);
      showToast(isEn ? 'Address removed' : 'Đã gỡ địa chỉ IPv6', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi gỡ địa chỉ', 'error');
    } finally {
      setBusyAddr(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {isEn ? 'Loading IPv6 Pool...' : 'Đang tải Kho IPv6 cục bộ...'}
      </div>
    );
  }

  const entries = status?.entries ?? [];
  const orphans = status?.orphanAddresses ?? [];

  return (
    <div className="space-y-4">
      {/* Platform & Admin Privilege Banners */}
      {status && !status.supportedPlatform && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p>
              {isEn
                ? 'Local IPv6 Pool assignment is currently supported on Windows only. Linux/macOS support is tracked in docs/BACKLOG.md.'
                : 'Gán địa chỉ Kho IPv6 cục bộ hiện chỉ hỗ trợ Windows (Linux/macOS xem docs/BACKLOG.md).'}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3.5 text-xs text-muted-foreground">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              {isEn
                ? 'Important Limitations & Admin Privilege Notice'
                : 'Lưu ý giới hạn & Quyền quản trị (UAC)'}
            </p>
            <p>
              {isEn
                ? 'Facet never runs the entire app as Administrator — Windows UAC is requested ONLY when adding or removing IPv6 addresses via netsh. VPS/datacenter IPv6 ranges are often flagged as infrastructure rather than residential users, many websites do not support IPv6, and Facet does not promise "clean" IPs.'
                : 'Facet KHÔNG chạy toàn bộ ứng dụng với quyền quản trị — Windows UAC chỉ bật khi gán/gỡ địa chỉ IPv6 qua netsh. Dải IP của VPS/trung tâm dữ liệu thường bị coi là hạ tầng chứ không phải người dùng thường; nhiều trang web chưa hỗ trợ IPv6; app không hứa hẹn IP "sạch".'}
            </p>
          </div>
        </div>
      </div>

      {/* Orphan addresses banner */}
      {orphans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {isEn
                ? `Detected ${orphans.length} orphan IPv6 address(es) assigned by Facet from a previous session.`
                : `Phát hiện ${orphans.length} địa chỉ IPv6 mồ côi do Facet gán từ lần chạy trước.`}
            </span>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void handleRemoveAll()}
            disabled={cleaningAll}
          >
            {isEn ? 'Remove All App Addresses' : 'Gỡ tất cả địa chỉ của app'}
          </Button>
        </div>
      )}

      {/* Prefix & Routing Configuration Card */}
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {isEn
                ? 'IPv6 /64 Prefix & Routing Verification'
                : 'Cấu hình tiền tố /64 & Kiểm tra định tuyến'}
            </h3>
          </div>
          {status?.config.routingVerified ? (
            <StatusBadge variant="ready">
              {isEn ? 'Routing Verified' : 'Định tuyến hợp lệ'}
            </StatusBadge>
          ) : (
            <StatusBadge variant="warning">
              {isEn ? 'Unverified' : 'Chưa kiểm tra định tuyến'}
            </StatusBadge>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {isEn ? 'Network Interface' : 'Card mạng (Interface)'}
            </label>
            <Select
              value={ifaceName}
              onChange={(e) => {
                const next = e.target.value;
                setIfaceName(next);
                const found = interfaces.find((i) => i.name === next);
                if (found?.suggestedPrefixes[0]) {
                  setPrefix64(found.suggestedPrefixes[0]);
                }
              }}
            >
              <option value="">{isEn ? '-- Select interface --' : '-- Chọn card mạng --'}</option>
              {interfaces.map((iface) => (
                <option key={iface.name} value={iface.name}>
                  {iface.name} ({iface.addresses.length} global IPv6)
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {isEn ? 'Global Unicast /64 Prefix (2000::/3)' : 'Tiền tố /64 (chỉ 2000::/3)'}
            </label>
            <Input
              value={prefix64}
              onChange={(e) => setPrefix64(e.target.value)}
              placeholder="2001:db8:abcd:1::/64"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {isEn ? 'Pool Limit (1 - 1024)' : 'Giới hạn số địa chỉ (1 - 1024)'}
            </label>
            <Input
              type="number"
              min={1}
              max={1024}
              value={maxAddresses}
              onChange={(e) => setMaxAddresses(Number(e.target.value) || 256)}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={ownershipConfirmed}
            onChange={(e) => setOwnershipConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-border"
          />
          <span>
            {isEn
              ? 'I own or am explicitly authorized to use this IPv6 /64 prefix.'
              : 'Tôi sở hữu hoặc được ủy quyền sử dụng tiền tố IPv6 /64 này.'}
          </span>
        </label>

        {/* Scheduled auto-rotate (default OFF, min 10 min) */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/70 bg-secondary/20 px-3 py-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRotateEnabled}
              onChange={(e) => setAutoRotateEnabled(e.target.checked)}
            />
            <span>
              {isEn
                ? 'Scheduled auto-rotate (idle profiles only)'
                : 'Xoay IPv6 theo hẹn giờ (chỉ hồ sơ đang dừng)'}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {isEn ? 'Interval (min 10m):' : 'Chu kỳ (tối thiểu 10 phút):'}
            </span>
            <Input
              type="number"
              min={10}
              max={1440}
              value={autoRotateMinutes}
              onChange={(e) => setAutoRotateMinutes(Math.max(10, Number(e.target.value) || 10))}
              className="h-7 w-20 text-xs"
              disabled={!autoRotateEnabled}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleSaveConfig()}>
            {isEn ? 'Save Config' : 'Lưu cấu hình'}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleVerifyRouting()}
            disabled={verifying || !ownershipConfirmed || !ifaceName || !prefix64}
            className="gap-1.5"
          >
            {verifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
            <span>{isEn ? 'Verify Routing' : 'Kiểm tra định tuyến'}</span>
          </Button>
        </div>

        {routingResult && (
          <div
            className={
              routingResult.ok
                ? 'rounded-lg border border-primary/40 bg-primary/10 p-3 text-xs text-primary'
                : 'rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive'
            }
          >
            <div className="flex items-center gap-2 font-medium">
              {routingResult.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              <span>
                {routingResult.ok
                  ? isEn
                    ? `Matched! Test IPv6 ${routingResult.testedAddress} routed via ${routingResult.endpointUsed}`
                    : `Khớp! Địa chỉ thử ${routingResult.testedAddress} đã định tuyến thành công qua ${routingResult.endpointUsed}`
                  : routingResult.error}
              </span>
            </div>
            {routingResult.guidance && (
              <p className="mt-1.5 text-foreground/90">{routingResult.guidance}</p>
            )}
          </div>
        )}
      </Card>

      {/* Pool Actions & Table */}
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={64}
              value={allocateCount}
              onChange={(e) =>
                setAllocateCount(Math.max(1, Math.min(64, Number(e.target.value) || 1)))
              }
              className="h-8 w-20 text-xs"
              aria-label={isEn ? 'Addresses to assign' : 'Số địa chỉ cần gán'}
            />
            <Button
              size="sm"
              onClick={() => void handleAllocate()}
              disabled={allocating || !status?.config.routingVerified}
              className="gap-1.5"
            >
              {allocating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>{isEn ? 'Assign Addresses' : 'Tạo & gán địa chỉ'}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCheckHealthAll()}
              disabled={checkingAll || entries.length === 0}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingAll ? 'animate-spin' : ''}`} />
              <span>{isEn ? 'Check All Alive/Dead' : 'Kiểm tra sống/chết tất cả'}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRotateAll()}
              disabled={entries.length === 0}
            >
              {isEn ? 'Rotate All' : 'Xoay tất cả'}
            </Button>
          </div>

          <Button
            size="sm"
            variant="destructive"
            onClick={() => void handleRemoveAll()}
            disabled={cleaningAll || entries.length === 0}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{isEn ? 'Remove All App Addresses' : 'Gỡ tất cả địa chỉ của app'}</span>
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">
                  {isEn ? 'IPv6 Address' : 'Địa chỉ IPv6'}
                </th>
                <th className="px-3 py-2.5 font-medium">{isEn ? 'Profile' : 'Hồ sơ đang dùng'}</th>
                <th className="px-3 py-2.5 font-medium">
                  {isEn ? 'Local Listener' : 'Cổng cục bộ'}
                </th>
                <th className="px-3 py-2.5 font-medium">{isEn ? 'Connections' : 'Kết nối'}</th>
                <th className="px-3 py-2.5 font-medium">{isEn ? 'Health' : 'Trạng thái'}</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {isEn ? 'Actions' : 'Thao tác'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {isEn
                      ? 'No IPv6 pool addresses assigned yet. Verify routing above first.'
                      : 'Chưa có địa chỉ IPv6 nào được gán. Hãy kiểm tra định tuyến trước rồi nhấn "Tạo & gán địa chỉ".'}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.address} className="hover:bg-accent/30">
                    <td className="px-3 py-2.5 font-mono text-foreground">{entry.address}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {entry.profileName ?? (isEn ? 'Unassigned' : 'Chưa gán hồ sơ')}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-muted-foreground">
                      {entry.listenPort ? `127.0.0.1:${entry.listenPort}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono">
                      <Badge variant="outline">{entry.activeConnections}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      {entry.health === 'alive' ? (
                        <StatusBadge variant="ready">{isEn ? 'Alive' : 'Sống'}</StatusBadge>
                      ) : entry.health === 'dead' ? (
                        <StatusBadge variant="warning">{isEn ? 'Dead' : 'Chết'}</StatusBadge>
                      ) : (
                        <StatusBadge variant="stopped">
                          {isEn ? 'Unknown' : 'Chưa kiểm tra'}
                        </StatusBadge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {entry.profileId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={busyAddr === entry.address}
                            onClick={() =>
                              void handleRotateProfile(entry.profileId!, entry.address)
                            }
                          >
                            {isEn ? 'Rotate' : 'Đổi'}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          aria-label={isEn ? `Remove ${entry.address}` : `Gỡ ${entry.address}`}
                          title={isEn ? 'Remove' : 'Gỡ'}
                          disabled={busyAddr === entry.address}
                          onClick={() => void handleRemoveSingle(entry.address)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
