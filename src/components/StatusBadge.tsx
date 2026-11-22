import { cn } from '@/lib/utils';

export type FacetStatusVariant = 'ready' | 'running' | 'warning' | 'stopped';

const STATUS_STYLE_MAP: Record<FacetStatusVariant, { backgroundColor: string; color: string }> = {
  ready: {
    backgroundColor: 'var(--status-ready-bg)',
    color: 'var(--status-ready-fg)',
  },
  running: {
    backgroundColor: 'var(--status-running-bg)',
    color: 'var(--status-running-fg)',
  },
  warning: {
    backgroundColor: 'var(--status-warning-bg)',
    color: 'var(--status-warning-fg)',
  },
  stopped: {
    backgroundColor: 'var(--status-stopped-bg)',
    color: 'var(--status-stopped-fg)',
  },
};

export interface StatusBadgeProps {
  variant: FacetStatusVariant;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({
  variant,
  children,
  className,
}: StatusBadgeProps): React.JSX.Element {
  return (
    <span
      data-status-variant={variant}
      style={STATUS_STYLE_MAP[variant]}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: 'currentColor' }}
      />
      {children}
    </span>
  );
}
