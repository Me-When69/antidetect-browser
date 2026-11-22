import { cn } from '@/lib/utils';

export interface FacetLogoProps {
  size?: number;
  surface?: 'dark' | 'light';
  showWordmark?: boolean;
  showTagline?: boolean;
  tagline?: string;
  className?: string;
}

export function FacetLogo({
  size = 32,
  surface = 'dark',
  showWordmark = false,
  showTagline = false,
  tagline = 'Mỗi hồ sơ, một danh tính riêng.',
  className,
}: FacetLogoProps): React.JSX.Element {
  const strokeColor = surface === 'light' ? '#F4F6FA' : '#0E1116';

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Facet"
        className="shrink-0"
      >
        <g stroke={strokeColor} strokeWidth="2" strokeLinejoin="round">
          <polygon points="32,4 56,18 32,32 8,18" fill="#2DD4BF" />
          <polygon points="8,18 32,32 32,60 8,46" fill="#7C5CFF" />
          <polygon points="32,32 56,18 56,46 32,60" fill="#4B33C9" />
        </g>
      </svg>

      {showWordmark && (
        <div className="min-w-0 leading-tight">
          <div
            className={cn(
              'font-display text-base font-bold tracking-tight',
              surface === 'light' ? 'text-[#0E1116]' : 'text-foreground',
            )}
          >
            Facet
          </div>
          {showTagline && (
            <div
              className={cn(
                'truncate text-[11px]',
                surface === 'light' ? 'text-[#475569]' : 'text-muted-foreground',
              )}
            >
              {tagline}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
