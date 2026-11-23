import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file
const MAX_ROTATED_FILES = 3;

export function redactSensitive(input: string): string {
  return input
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/otpauth:\/\/[^\s"'`]+/gi, 'otpauth://[REDACTED]')
    .replace(
      /((?:password|passwd|pwd|refresh_token|access_token|id_token|client_secret|code_verifier|totp(?:_secret)?|token|api[_-]?key|secret)\s*["']?\s*[:=]\s*["']?)[^\s,;}"']+/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?|socks4a?|socks5h?|ssh):\/\/([^:/\s]+):([^@/\s]+)@/gi, '$1://$2:[REDACTED]@')
    .replace(
      /\b([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
      '$1***$3',
    );
}

export class AppLogger {
  private entries: string[] = [];
  private logFilePath: string | null;
  private maxEntries = 500;
  private writeCount = 0;

  constructor(logDir?: string) {
    if (logDir) {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logFilePath = path.join(logDir, 'facet.log');
      this.rotateIfNeeded();
    } else {
      this.logFilePath = null;
    }
  }

  private rotateIfNeeded(): void {
    if (!this.logFilePath || !fs.existsSync(this.logFilePath)) return;
    try {
      const stat = fs.statSync(this.logFilePath);
      if (stat.size < MAX_LOG_FILE_BYTES) return;
      for (let i = MAX_ROTATED_FILES; i >= 1; i -= 1) {
        const src = i === 1 ? this.logFilePath : `${this.logFilePath}.${i - 1}`;
        const dst = `${this.logFilePath}.${i}`;
        if (fs.existsSync(src)) {
          if (i === MAX_ROTATED_FILES && fs.existsSync(dst)) {
            fs.unlinkSync(dst);
          }
          fs.renameSync(src, dst);
        }
      }
    } catch {
      // Ignore rotation errors
    }
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const safeMsg = redactSensitive(message);
    const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${safeMsg}`;
    this.entries.push(line);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    if (this.logFilePath) {
      try {
        this.writeCount += 1;
        if (this.writeCount % 50 === 0) {
          this.rotateIfNeeded();
        }
        fs.appendFileSync(this.logFilePath, `${line}\n`, 'utf8');
      } catch {
        // Ignore disk write errors for logs
      }
    }
  }

  info(scope: string, message: string): void {
    this.write('INFO', scope, message);
  }

  warn(scope: string, message: string): void {
    this.write('WARN', scope, message);
  }

  error(scope: string, message: string): void {
    this.write('ERROR', scope, message);
  }

  exportLogs(): string {
    return this.entries.join('\n');
  }
}
