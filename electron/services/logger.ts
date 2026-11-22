import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export class AppLogger {
  private entries: string[] = [];
  private logFilePath: string | null;
  private maxEntries = 500;

  constructor(logDir?: string) {
    if (logDir) {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logFilePath = path.join(logDir, 'antidetect.log');
    } else {
      this.logFilePath = null;
    }
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`;
    this.entries.push(line);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    if (this.logFilePath) {
      try {
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
