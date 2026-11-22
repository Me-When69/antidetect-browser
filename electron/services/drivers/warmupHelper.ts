import type { BrowserContext } from 'playwright-core';
import type { WarmupConfig, WarmupResult } from '@shared/types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

export async function runContextWarmup(
  profileId: string,
  context: BrowserContext,
  config: WarmupConfig,
): Promise<WarmupResult> {
  const urls = config.urls.map((u) => u.trim()).filter(Boolean);
  let visited = 0;
  let failed = 0;

  const page = await context.newPage();
  try {
    for (const rawUrl of urls) {
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        visited += 1;

        const stayMs = Math.round(randomBetween(config.minStaySec, config.maxStaySec) * 1000);
        if (config.scroll) {
          const steps = Math.max(2, Math.min(6, Math.floor(stayMs / 1500)));
          const stepWait = Math.floor(stayMs / steps);
          for (let s = 0; s < steps; s += 1) {
            const deltaY = Math.round(randomBetween(180, 520));
            await page.mouse.wheel(0, deltaY).catch(() => {});
            await sleep(stepWait);
          }
        } else {
          await sleep(stayMs);
        }
      } catch {
        failed += 1;
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { profileId, visited, failed };
}
