import fs from 'node:fs';
import path from 'node:path';

const BUDGETS = {
  distTotalKb: 1100,
  entryJsKb: 220,
  mainJsKb: 650,
};

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

const root = process.cwd();
const distKb = dirSize(path.join(root, 'dist')) / 1024;
const assetsDir = path.join(root, 'dist', 'assets');
const entryFile = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f))
  : null;
const entryKb = entryFile ? fs.statSync(path.join(assetsDir, entryFile)).size / 1024 : 0;
const mainPath = path.join(root, 'dist-electron', 'main.js');
const mainKb = fs.existsSync(mainPath) ? fs.statSync(mainPath).size / 1024 : 0;

const failures = [];
if (distKb > BUDGETS.distTotalKb) {
  failures.push(`dist/ total ${distKb.toFixed(1)} KB > budget ${BUDGETS.distTotalKb} KB`);
}
if (entryKb > BUDGETS.entryJsKb) {
  failures.push(`renderer entry ${entryKb.toFixed(1)} KB > budget ${BUDGETS.entryJsKb} KB`);
}
if (mainKb > BUDGETS.mainJsKb) {
  failures.push(`dist-electron/main.js ${mainKb.toFixed(1)} KB > budget ${BUDGETS.mainJsKb} KB`);
}

if (failures.length > 0) {
  console.error('Performance budget exceeded:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Perf budget OK: dist=${distKb.toFixed(1)} KB (<= ${BUDGETS.distTotalKb}), entry=${entryKb.toFixed(1)} KB (<= ${BUDGETS.entryJsKb}), main=${mainKb.toFixed(1)} KB (<= ${BUDGETS.mainJsKb})`,
);
