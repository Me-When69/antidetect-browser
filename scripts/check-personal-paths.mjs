import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_MOCK_USERS = new Set([
  'test',
  'user',
  'example',
  'alice',
  'bob',
  'runner',
  'ci',
  '...',
  '<user>',
]);

const FORBIDDEN_PATTERNS = [
  { name: 'file:// URI', re: /file:\/\/\/(?!\.\.\.)[^\s)"'`]+/gi },
  { name: 'Windows C:\\Users\\ personal path', re: /C:\\{1,2}Users\\{1,2}([A-Za-z0-9._-]+)/gi },
  { name: 'macOS /Users/ personal path', re: /\/Users\/([A-Za-z0-9._-]+)/g },
  { name: 'Linux /home/ personal path', re: /\/home\/([A-Za-z0-9._-]+)/g },
];

const SKIP_FILES = new Set([
  'package-lock.json',
  'scripts/check-personal-paths.mjs',
  'scripts/check-secrets.mjs',
  '.gitleaks.toml',
]);

export function scanTextForPersonalPaths(content, relPath) {
  const hits = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const rule of FORBIDDEN_PATTERNS) {
      rule.re.lastIndex = 0;
      let match;
      while ((match = rule.re.exec(line)) !== null) {
        const capturedUser = (match[1] ?? '').toLowerCase();
        if (capturedUser && ALLOWED_MOCK_USERS.has(capturedUser)) {
          continue;
        }
        hits.push(`${relPath}:${idx + 1}: [${rule.name}] ${match[0]}`);
      }
    }
  });
  return hits;
}

function main() {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);

  const violations = [];
  for (const rel of tracked) {
    if (SKIP_FILES.has(rel)) continue;
    if (/\.(png|jpg|jpeg|ico|woff|woff2|exe|zip|db)$/i.test(rel)) continue;
    const full = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(full)) continue;
    const content = fs.readFileSync(full, 'utf8');
    violations.push(...scanTextForPersonalPaths(content, rel));
  }

  if (violations.length > 0) {
    console.error('Personal/absolute path check FAILED:');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log(`Personal path check OK (${tracked.length} tracked files scanned).`);
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('check-personal-paths.mjs')
) {
  main();
}
