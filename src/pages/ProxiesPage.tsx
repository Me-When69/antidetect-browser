import { useState } from 'react';
import { CheckCircle2, Globe, Loader2, Network, Plus, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Ipv6PoolPanel } from '@/components/Ipv6PoolPanel';
import { getTranslations } from '@/i18n';
import { useAppStore } from '@/store/useAppStore';
import { parseQuickProxy } from '@shared/validation';
import type { ProxyCheckResult, SavedProxy } from '@shared/types';

export function ProxiesPage(): React.JSX.Element {
  const { locale, proxies, refreshProxies, showToast } = useAppStore();
  const dict = getTranslations(locale);
  const isEn = locale === 'en';
  const [activeTab, setActiveTab] = useState<'saved' | 'ipv6pool'>('saved');

  const [quickText, setQuickText] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<SavedProxy['type']>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, ProxyCheckResult>>({});

  const applyQuickPaste = (): void => {
    const parsed = parseQuickProxy(quickText, type);
    if (!parsed || parsed.type === 'none' || parsed.type === 'ipv6pool') {
      showToast('Định dạng proxy không hợp lệ (dùng host:port:user:pass hoặc URL)', 'error');
      return;
    }
    setType(parsed.type);
    setHost(parsed.host);
    setPort(String(parsed.port));
    setUsername(parsed.username);
    setPassword(parsed.password);
    if (!name.trim()) {
      setName(`${parsed.host}:${parsed.port}`);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const portNum = Number(port);
    if (!host.trim() || !Number.isInteger(portNum) || portNum < 1 || !window.electronAPI) {
      showToast('Vui lòng nhập đúng Host và Port', 'error');
      return;
    }
    await window.electronAPI.createProxy({
      name: name.trim() || `${host.trim()}:${portNum}`,
      type,
      host: host.trim(),
      port: portNum,
      username: username.trim(),
      password,
      country: '',
    });
    setName('');
    setHost('');
    setPort('');
    setUsername('');
    setPassword('');
    setQuickText('');
    await refreshProxies();
    showToast('Đã thêm proxy vào kho', 'success');
  };

  const handleCheck = async (proxy: SavedProxy): Promise<void> => {
    if (!window.electronAPI) return;
    setCheckingId(proxy.id);
    try {
      const res = await window.electronAPI.checkProxy({
        type: proxy.type,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      });
      setCheckResults((prev) => ({ ...prev, [proxy.id]: res }));
      if (res.ok && res.country) {
        await window.electronAPI.updateProxy(proxy.id, { country: res.country });
        await refreshProxies();
      }
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteProxy(id);
    await refreshProxies();
    showToast('Đã xóa proxy', 'info');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{dict.proxies.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{dict.proxies.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('saved')}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
              activeTab === 'saved'
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{isEn ? 'Saved Proxies' : 'Proxy đã lưu'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ipv6pool')}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors ${
              activeTab === 'ipv6pool'
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            <span>{isEn ? 'Local IPv6 Pool' : 'Kho IPv6 cục bộ'}</span>
          </button>
        </div>
      </div>

      {activeTab === 'ipv6pool' ? (
        <Ipv6PoolPanel />
      ) : (
        <>
          <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder={dict.proxies.quickPaste}
            className="max-w-md"
          />
          <Button variant="secondary" size="sm" onClick={applyQuickPaste}>
            {dict.form.applyProxy}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-6">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên gợi nhớ" />
          <Select value={type} onChange={(e) => setType(e.target.value as SavedProxy['type'])}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </Select>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host / IP" />
          <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="Port" />
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="User"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Pass"
          />
        </div>

        <div>
          <Button onClick={() => void handleAdd()}>
            <Plus className="h-4 w-4" />
            {dict.proxies.addTitle}
          </Button>
        </div>
      </Card>

      {proxies.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">{dict.proxies.empty}</Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Tên</th>
                <th className="px-4 py-3">Loại</th>
                <th className="px-4 py-3">Địa chỉ</th>
                <th className="px-4 py-3">Trạng thái kiểm tra</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {proxies.map((proxy) => {
                const res = checkResults[proxy.id];
                return (
                  <tr key={proxy.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3 font-medium">{proxy.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{proxy.type.toUpperCase()}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {proxy.host}:{proxy.port}
                      {proxy.username ? ` (${proxy.username})` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {res ? (
                        res.ok ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {res.ip} • {res.country} ({res.latencyMs}ms)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-destructive">
                            <XCircle className="h-3.5 w-3.5" />
                            {res.error}
                          </span>
                        )
                      ) : proxy.country ? (
                        <span className="text-muted-foreground">{proxy.country}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={checkingId === proxy.id}
                          onClick={() => void handleCheck(proxy)}
                        >
                          {checkingId === proxy.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Globe className="h-3.5 w-3.5" />
                          )}
                          {dict.proxies.checkBtn}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => void handleDelete(proxy.id)}
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
        </>
      )}
    </div>
  );
}
