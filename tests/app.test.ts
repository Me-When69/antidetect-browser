import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import { getTranslations } from '@/i18n';
import { cn } from '@/lib/utils';

describe('Step 0 foundation', () => {
  it('defines typed IPC channels', () => {
    expect(IPC_CHANNELS.APP_GET_INFO).toBe('app:getInfo');
  });

  it('loads Vietnamese i18n navigation labels', () => {
    const vi = getTranslations('vi');
    expect(vi.nav.allProfiles).toBe('Tất cả hồ sơ');
    expect(vi.nav.folders).toBe('Thư mục');
    expect(vi.nav.proxies).toBe('Proxy');
    expect(vi.nav.settings).toBe('Cài đặt');
  });

  it('merges Tailwind class names cleanly', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
