import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIRS = ['electron', 'src', 'shared'];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));

const findings = {
  anyUsage: [],
  tsIgnore: [],
  sqlConcat: [],
  shellExec: [],
  runAsNodeForbidden: [],
  ipcWithoutSenderCheck: [],
  emptyCatch: [],
  setIntervalCount: [],
  windowSecurity: {},
  localApiSecurity: {},
};

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const importsChildProcess = /from\s+['"](?:node:)?child_process['"]/.test(content);

  lines.forEach((line, idx) => {
    const ln = idx + 1;
    if (/\b:\s*any\b|\bas\s+any\b|<any>/.test(line)) {
      findings.anyUsage.push(`${rel}:${ln}: ${line.trim()}`);
    }
    if (/@ts-ignore|@ts-expect-error/.test(line)) {
      findings.tsIgnore.push(`${rel}:${ln}: ${line.trim()}`);
    }
    if (/(?:\.prepare|\.exec)\s*\(\s*`[^`]*\$\{/.test(line)) {
      findings.sqlConcat.push(`${rel}:${ln}: ${line.trim()}`);
    }
    if (/\bexecSync\s*\(|\bexec\s*\(|shell\s*:\s*true/.test(line) && !rel.includes('db/')) {
      findings.shellExec.push(`${rel}:${ln}: ${line.trim()}`);
    }
    // Forbid patterns incompatible with Electron Fuse RunAsNode=false
    if (
      /ELECTRON_RUN_AS_NODE/.test(line) ||
      /\b(?:spawn|execFile)\s*\(\s*process\.execPath\b/.test(line) ||
      /child_process\s*\.\s*fork\s*\(/.test(line) ||
      (importsChildProcess && /\bfork\s*\(/.test(line) && !/utilityProcess\s*\.\s*fork/.test(line))
    ) {
      findings.runAsNodeForbidden.push(`${rel}:${ln}: ${line.trim()}`);
    }
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
      findings.emptyCatch.push(`${rel}:${ln}`);
    }
    if (/\bsetInterval\s*\(/.test(line)) {
      findings.setIntervalCount.push(`${rel}:${ln}: ${line.trim()}`);
    }
  });

  if (rel === 'electron/main.ts') {
    const rawHandles = [];
    lines.forEach((line, idx) => {
      if (line.includes('ipcMain.handle(')) {
        rawHandles.push(`${rel}:${idx + 1}: ${line.trim()}`);
      }
    });
    findings.ipcWithoutSenderCheck = rawHandles;
    findings.windowSecurity = {
      hasContextIsolation: content.includes('contextIsolation: true'),
      hasNodeIntegrationFalse: content.includes('nodeIntegration: false'),
      hasSandboxTrue: content.includes('sandbox: true'),
      hasWillNavigateGuard: content.includes('will-navigate'),
      hasWindowOpenHandler: content.includes('setWindowOpenHandler'),
      hasCspHeader: content.includes('Content-Security-Policy'),
    };
  }

  if (rel === 'electron/services/localApi.ts') {
    findings.localApiSecurity = {
      bindsLocalhostOnly: content.includes("'127.0.0.1'") || content.includes('"127.0.0.1"'),
      checksApiKey: content.includes('x-api-key') || content.includes('authorization'),
      checksHostOrOrigin: /origin|host/i.test(content),
      hasRateLimit: /rate.?limit|maxRequests|windowMs/i.test(content),
    };
  }
}

const report = {
  scannedFiles: files.length,
  anyUsageCount: findings.anyUsage.length,
  anyUsage: findings.anyUsage,
  tsIgnoreCount: findings.tsIgnore.length,
  sqlConcat: findings.sqlConcat,
  shellExec: findings.shellExec,
  runAsNodeForbiddenCount: findings.runAsNodeForbidden.length,
  runAsNodeForbidden: findings.runAsNodeForbidden,
  emptyCatchCount: findings.emptyCatch.length,
  setIntervalCount: findings.setIntervalCount,
  mainIpcRawHandleCount: findings.ipcWithoutSenderCheck.length,
  windowSecurity: findings.windowSecurity,
  localApiSecurity: findings.localApiSecurity,
};

console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--strict')) {
  const failures = [];
  if (report.anyUsageCount > 0) failures.push(`anyUsageCount=${report.anyUsageCount}`);
  if (report.tsIgnoreCount > 0) failures.push(`tsIgnoreCount=${report.tsIgnoreCount}`);
  if (report.runAsNodeForbiddenCount > 0) {
    failures.push(`runAsNodeForbidden=${JSON.stringify(report.runAsNodeForbidden)}`);
  }
  if (report.mainIpcRawHandleCount > 0) {
    failures.push(`mainIpcRawHandleCount=${report.mainIpcRawHandleCount}`);
  }
  if (failures.length > 0) {
    console.error(`Static scan FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
}
