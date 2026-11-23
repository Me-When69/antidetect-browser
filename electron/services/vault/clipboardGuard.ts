import crypto from 'node:crypto';

export interface ClipboardAdapter {
  readText: () => string;
  writeText: (text: string) => void;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Main-process clipboard guard: writes sensitive values (passwords / TOTP)
 * directly to the OS clipboard and auto-clears after `ttlMs` (default 20s)
 * ONLY if the clipboard still contains the exact copied value.
 */
export class ClipboardGuard {
  private adapter: ClipboardAdapter;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastHash: string | null = null;

  constructor(adapter: ClipboardAdapter) {
    this.adapter = adapter;
  }

  copySensitive(value: string, ttlMs = 20_000): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.adapter.writeText(value);
    const expectedHash = sha256(value);
    this.lastHash = expectedHash;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.clearIfUnchanged(expectedHash);
    }, ttlMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private clearIfUnchanged(expectedHash: string): void {
    try {
      const current = this.adapter.readText();
      if (current && sha256(current) === expectedHash) {
        this.adapter.writeText('');
      }
    } catch {
      // Ignore clipboard access errors
    } finally {
      if (this.lastHash === expectedHash) {
        this.lastHash = null;
      }
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.lastHash) {
      const h = this.lastHash;
      this.lastHash = null;
      this.clearIfUnchanged(h);
    }
  }
}
