import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { ProfileDataOnClose } from '@shared/types';

function safeRemove(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Ignore transient OS locks on profile shutdown
  }
}

export function hasAnyDataOnClose(cfg?: ProfileDataOnClose | null): boolean {
  if (!cfg) return false;
  return Boolean(cfg.clearCookies || cfg.clearCache || cfg.clearHistory || cfg.clearLocalStorage);
}

/**
 * Run in-context cleanup BEFORE closing the browser (cookies / localStorage).
 */
export async function applyInContextCleanup(
  context: BrowserContext,
  cfg?: ProfileDataOnClose | null,
): Promise<void> {
  if (!cfg) return;
  if (cfg.clearCookies) {
    await context.clearCookies().catch(() => {});
  }
  if (cfg.clearLocalStorage) {
    for (const page of context.pages()) {
      await page
        .evaluate(() => {
          try {
            window.localStorage.clear();
          } catch {
            // Ignore opaque origin localStorage errors
          }
          try {
            window.sessionStorage.clear();
          } catch {
            // Ignore opaque origin sessionStorage errors
          }
        })
        .catch(() => {});
    }
  }
}

/**
 * Clean profile disk artifacts AFTER the browser context has closed.
 * Does nothing if all flags are false.
 */
export function applyDiskDataOnClose(userDataDir: string, cfg?: ProfileDataOnClose | null): void {
  if (!hasAnyDataOnClose(cfg) || !cfg || !fs.existsSync(userDataDir)) return;

  const defaultDir = path.join(userDataDir, 'Default');

  if (cfg.clearCookies) {
    // Chromium
    safeRemove(path.join(defaultDir, 'Cookies'));
    safeRemove(path.join(defaultDir, 'Cookies-journal'));
    safeRemove(path.join(defaultDir, 'Network', 'Cookies'));
    safeRemove(path.join(defaultDir, 'Network', 'Cookies-journal'));
    // Firefox
    safeRemove(path.join(userDataDir, 'cookies.sqlite'));
    safeRemove(path.join(userDataDir, 'cookies.sqlite-wal'));
    safeRemove(path.join(userDataDir, 'cookies.sqlite-shm'));
  }

  if (cfg.clearCache) {
    // Chromium
    safeRemove(path.join(defaultDir, 'Cache'));
    safeRemove(path.join(defaultDir, 'Code Cache'));
    safeRemove(path.join(defaultDir, 'GPUCache'));
    safeRemove(path.join(userDataDir, 'GrShaderCache'));
    safeRemove(path.join(userDataDir, 'ShaderCache'));
    safeRemove(path.join(userDataDir, 'static-cache'));
    // Firefox
    safeRemove(path.join(userDataDir, 'cache2'));
  }

  if (cfg.clearHistory) {
    // Chromium
    safeRemove(path.join(defaultDir, 'History'));
    safeRemove(path.join(defaultDir, 'History-journal'));
    safeRemove(path.join(defaultDir, 'Visited Links'));
    safeRemove(path.join(defaultDir, 'Top Sites'));
    // Firefox
    safeRemove(path.join(userDataDir, 'places.sqlite'));
    safeRemove(path.join(userDataDir, 'places.sqlite-wal'));
  }

  if (cfg.clearLocalStorage) {
    // Chromium
    safeRemove(path.join(defaultDir, 'Local Storage'));
    safeRemove(path.join(defaultDir, 'Session Storage'));
    safeRemove(path.join(defaultDir, 'IndexedDB'));
    // Firefox
    safeRemove(path.join(userDataDir, 'storage'));
    safeRemove(path.join(userDataDir, 'webappsstore.sqlite'));
  }
}
