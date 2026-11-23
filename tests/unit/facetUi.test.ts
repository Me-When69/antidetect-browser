import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FacetLogo } from '../../src/components/FacetLogo';
import { StatusBadge } from '../../src/components/StatusBadge';
import { AboutModal } from '../../src/components/AboutModal';
import { FACET_DARK_TOKENS, FACET_LIGHT_TOKENS } from '../../shared/facetTokens';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Facet UI components (Logo, StatusBadge, AboutModal)', () => {
  it('renders FacetLogo with 3 hexagon faces and correct dark/light strokes', () => {
    const darkHtml = renderToStaticMarkup(
      React.createElement(FacetLogo, {
        size: 48,
        surface: 'dark',
        showWordmark: true,
        showTagline: true,
      }),
    );
    expect(darkHtml).toContain('aria-label="Facet"');
    expect(darkHtml).toContain('stroke="#0E1116"');
    expect(darkHtml).toContain('fill="#2DD4BF"');
    expect(darkHtml).toContain('fill="#7C5CFF"');
    expect(darkHtml).toContain('fill="#4B33C9"');
    expect(darkHtml).toContain('Facet');
    expect(darkHtml).toContain('Mỗi hồ sơ, một danh tính riêng.');

    const lightHtml = renderToStaticMarkup(
      React.createElement(FacetLogo, { size: 32, surface: 'light' }),
    );
    expect(lightHtml).toContain('stroke="#F4F6FA"');
  });

  it('renders StatusBadge for all 4 Facet status variants', () => {
    const variants = [
      { variant: 'ready', label: 'Sẵn sàng' },
      { variant: 'running', label: 'Đang chạy' },
      { variant: 'warning', label: 'Cảnh báo' },
      { variant: 'stopped', label: 'Đã dừng' },
    ] as const;

    for (const item of variants) {
      const html = renderToStaticMarkup(
        React.createElement(StatusBadge, { variant: item.variant, children: item.label }),
      );
      expect(html).toContain(`data-status-variant="${item.variant}"`);
      expect(html).toContain(item.label);
    }
  });

  it('renders AboutModal with Facet branding, version, and Apache-2.0 notice', () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutModal, {
        open: true,
        onClose: () => {},
        locale: 'vi',
        appInfo: {
          name: 'Facet',
          version: '0.1.0',
          platform: 'win32',
          electronVersion: '36.3.1',
          dataDir: './data',
        },
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Apache-2.0');
    expect(html).toContain('v0.1.0');
    expect(html).toContain('Mỗi hồ sơ, một danh tính riêng.');
  });

  it('generated Facet app icons exist in build/icons', () => {
    const iconsDir = path.resolve(process.cwd(), 'build', 'icons');
    for (const file of [
      'icon.svg',
      'icon.png',
      'icon.ico',
      '16x16.png',
      '32x32.png',
      '64x64.png',
      '128x128.png',
      '256x256.png',
      '512x512.png',
      '1024x1024.png',
    ]) {
      expect(fs.existsSync(path.join(iconsDir, file)), `Missing icon: ${file}`).toBe(true);
    }
  });
});

describe('Facet Design Tokens WCAG 2.1 contrast (>= 4.5:1)', () => {
  it('meets >= 4.5:1 contrast for all Dark theme primary & status pairs', () => {
    const t = FACET_DARK_TOKENS;
    const pairs: [string, string, string][] = [
      ['textPrimary / bgApp', t.textPrimary, t.bgApp],
      ['textPrimary / bgSidebar', t.textPrimary, t.bgSidebar],
      ['textPrimary / bgCard', t.textPrimary, t.bgCard],
      ['textSecondary / bgApp', t.textSecondary, t.bgApp],
      ['textSecondary / bgCard', t.textSecondary, t.bgCard],
      ['textMuted / bgApp', t.textMuted, t.bgApp],
      ['textMuted / bgCard', t.textMuted, t.bgCard],
      ['accentTealFg / accentTeal', t.accentTealFg, t.accentTeal],
      ['statusReadyFg / statusReadyBg', t.statusReadyFg, t.statusReadyBg],
      ['statusRunningFg / statusRunningBg', t.statusRunningFg, t.statusRunningBg],
      ['statusWarningFg / statusWarningBg', t.statusWarningFg, t.statusWarningBg],
      ['statusStoppedFg / statusStoppedBg', t.statusStoppedFg, t.statusStoppedBg],
    ];

    for (const [name, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `Dark contrast too low for ${name}: ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets >= 4.5:1 contrast for all Light theme primary & status pairs', () => {
    const t = FACET_LIGHT_TOKENS;
    const pairs: [string, string, string][] = [
      ['textPrimary / bgApp', t.textPrimary, t.bgApp],
      ['textPrimary / bgCard', t.textPrimary, t.bgCard],
      ['textSecondary / bgCard', t.textSecondary, t.bgCard],
      ['textMuted / bgCard', t.textMuted, t.bgCard],
      ['statusReadyFg / statusReadyBg', t.statusReadyFg, t.statusReadyBg],
      ['statusRunningFg / statusRunningBg', t.statusRunningFg, t.statusRunningBg],
      ['statusWarningFg / statusWarningBg', t.statusWarningFg, t.statusWarningBg],
      ['statusStoppedFg / statusStoppedBg', t.statusStoppedFg, t.statusStoppedBg],
    ];

    for (const [name, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `Light contrast too low for ${name}: ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
