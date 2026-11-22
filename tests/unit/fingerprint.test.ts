import { describe, expect, it } from 'vitest';
import {
  generateConsistentIdentity,
  listDevicePresets,
} from '../../electron/services/fingerprint/generator';
import type { Platform } from '@shared/types';

const VALID_CORES = new Set([2, 4, 6, 8, 10, 12, 14, 16]);
const VALID_RAM = new Set([4, 8, 16, 18, 32, 36]);
const MAC_ONLY_FONTS = new Set(['San Francisco', 'Helvetica Neue', 'Apple Color Emoji', 'Menlo']);
const WIN_ONLY_FONTS = new Set(['Segoe UI', 'Calibri', 'Consolas', 'Cambria']);

describe('Unit: fingerprint generator', () => {
  it('sinh 200 profile cho mỗi OS (windows, macos, linux) đảm bảo nhất quán chéo UA, GPU, fonts, core/RAM và phiên bản Chrome', () => {
    const platforms: Platform[] = ['windows', 'macos', 'linux'];

    for (const platform of platforms) {
      for (let i = 0; i < 200; i += 1) {
        const id = generateConsistentIdentity(platform, 'chrome');

        // 1. UA matches platform
        if (platform === 'windows') expect(id.userAgent).toMatch(/Windows NT/);
        if (platform === 'macos') expect(id.userAgent).toMatch(/Macintosh|Mac OS X/);
        if (platform === 'linux') expect(id.userAgent).toMatch(/Linux|X11/);

        // 2. GPU valid for OS
        const renderer = id.fingerprint.webgl.renderer.toLowerCase();
        if (platform === 'windows') {
          expect(renderer).not.toContain('apple');
          expect(renderer).not.toContain('mesa');
        }
        if (platform === 'macos') {
          expect(renderer).not.toContain('direct3d11');
        }

        // 3. Fonts valid for OS
        if (platform === 'windows') {
          for (const font of id.fingerprint.fonts) {
            expect(MAC_ONLY_FONTS.has(font)).toBe(false);
          }
        }
        if (platform === 'macos') {
          for (const font of id.fingerprint.fonts) {
            expect(WIN_ONLY_FONTS.has(font)).toBe(false);
          }
        }

        // 4. Realistic cores & RAM
        expect(VALID_CORES.has(id.fingerprint.hardware.cores)).toBe(true);
        expect(VALID_RAM.has(id.fingerprint.hardware.memory)).toBe(true);

        // 5. Chrome version in UA equals browserVersion
        expect(id.userAgent).toContain(`Chrome/${id.browserVersion}`);
      }
    }
  });

  it('đảm bảo độ đa dạng tổ hợp GPU/độ phân giải trong kho preset (ít nhất 10 tổ hợp)', () => {
    const combos = new Set<string>();
    for (const preset of listDevicePresets()) {
      combos.add(`${preset.webgl.renderer}|${preset.screen.width}x${preset.screen.height}`);
    }
    expect(combos.size).toBeGreaterThanOrEqual(10);

    // 200 generated Windows profiles should also yield multiple distinct GPU/res combinations
    const winCombos = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = generateConsistentIdentity('windows', 'chrome');
      winCombos.add(
        `${id.fingerprint.webgl.renderer}|${id.fingerprint.screen.width}x${id.fingerprint.screen.height}`,
      );
    }
    expect(winCombos.size).toBeGreaterThanOrEqual(10);
  });
});
