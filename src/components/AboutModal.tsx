import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FacetLogo } from '@/components/FacetLogo';
import { getTranslations } from '@/i18n';
import type { AppInfo } from '@shared/ipc';
import type { LocaleCode } from '@shared/types';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  locale: LocaleCode;
  appInfo: AppInfo | null;
}

export function AboutModal({
  open,
  onClose,
  locale,
  appInfo,
}: AboutModalProps): React.JSX.Element | null {
  if (!open) return null;
  const dict = getTranslations(locale);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="facet-about-title"
    >
      <Card className="w-full max-w-lg space-y-5 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div id="facet-about-title">
            <FacetLogo size={48} showWordmark showTagline tagline={dict.app.tagline} />
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label={dict.common.close}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-[#0E1116] p-4">
            <FacetLogo size={40} surface="dark" showWordmark />
            <span className="text-[10px] text-[#98A2B3]">Dark Surface (#0E1116)</span>
          </div>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-[#F4F6FA] p-4">
            <FacetLogo size={40} surface="light" showWordmark />
            <span className="text-[10px] text-[#475569]">Light Surface (#F4F6FA)</span>
          </div>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              v{appInfo?.version ?? '0.1.0'}
            </Badge>
            {appInfo?.electronVersion && (
              <Badge variant="secondary" className="font-mono">
                Electron {appInfo.electronVersion}
              </Badge>
            )}
            <Badge variant="secondary">Apache-2.0</Badge>
          </div>
          <p className="font-medium text-foreground">{dict.app.licenseLabel}</p>
          <p className="leading-relaxed">{dict.app.limitationsNote}</p>
        </div>

        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={onClose}>
            {dict.common.close}
          </Button>
        </div>
      </Card>
    </div>
  );
}
