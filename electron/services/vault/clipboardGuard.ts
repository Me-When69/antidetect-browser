import crypto from 'node:crypto';

export interface ClipboardAdapter {
  readText: () => string | Promise<string>;
  writeText: (text: string) => void | Promise<void>;
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
    void this.adapter.writeText(value);
    const expectedHash = sha256(value);
    this.lastHash = expectedHash;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.clearIfUnchanged(expectedHash);
    }, ttlMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private clearIfUnchanged(expectedHash: string): void {
    const applyClear = (current: string): void => {
      try {
        if (current && sha256(current) === expectedHash) {
          void this.adapter.writeText('');
        }
      } catch {
        // Ignore clipboard access errors
      } finally {
        if (this.lastHash === expectedHash) {
          this.lastHash = null;
        }
      }
    };

    try {
      const maybePromise = this.adapter.readText();
      if (typeof maybePromise === 'string') {
        applyClear(maybePromise);
      } else {
        void maybePromise
          .then((val) => applyClear(val))
          .catch(() => {
            if (this.lastHash === expectedHash) {
              this.lastHash = null;
            }
          });
      }
    } catch {
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
      void this.clearIfUnchanged(h);
    }
  }
}
