import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_FILENAMES = [
  /(^|\/)vault\.db(-wal|-shm)?$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)token[^/]*\.json$/i,
  /\.eml$/i,
];

const SECRET_RULES = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'Google OAuth client secret', re: /GOCSPX-[0-9A-Za-z_-]{20,}/g },
  { name: 'Google OAuth access token', re: /ya29\.[0-9A-Za-z_-]{20,}/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const SKIP_PREFIXES = ['tests/', 'docs/'];
const SKIP_FILES = new Set(['package-lock.json', 'scripts/check-secrets.mjs', '.gitleaks.toml']);

function main() {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);

  const violations = [];
  for (const rel of tracked) {
    for (const badFile of FORBIDDEN_FILENAMES) {
      if (badFile.test(rel)) {
        violations.push(`${rel}: forbidden sensitive filename tracked in git`);
      }
    }
    if (SKIP_FILES.has(rel) || SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    if (/\.(png|jpg|jpeg|ico|woff|woff2|exe|zip|db)$/i.test(rel)) continue;

    const full = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/placeholder\s*=/.test(line)) return;
      for (const rule of SECRET_RULES) {
        rule.re.lastIndex = 0;
        if (rule.re.test(line)) {
          violations.push(`${rel}:${idx + 1}: potential ${rule.name}`);
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error('Secret scan FAILED:');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log(`Secret scan OK (${tracked.length} tracked files scanned).`);
}

main();
