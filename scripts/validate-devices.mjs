import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devicesDir = path.resolve(__dirname, '..', 'data', 'devices');

const EXPECTED_FILES = [
  { file: 'windows.json', platform: 'windows', minCount: 15 },
  { file: 'macos.json', platform: 'macos', minCount: 8 },
  { file: 'linux.json', platform: 'linux', minCount: 6 },
  { file: 'android.json', platform: 'android', minCount: 12 },
  { file: 'ios.json', platform: 'ios', minCount: 6 },
];

const errors = [];
const seenIds = new Set();
let totalCount = 0;

for (const spec of EXPECTED_FILES) {
  const fullPath = path.join(devicesDir, spec.file);
  if (!fs.existsSync(fullPath)) {
    errors.push(`Missing file: ${fullPath}`);
    continue;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  } catch (err) {
    errors.push(`Invalid JSON in ${spec.file}: ${err.message}`);
    continue;
  }

  if (!Array.isArray(parsed)) {
    errors.push(`${spec.file}: root must be an array`);
    continue;
  }

  if (parsed.length < spec.minCount) {
    errors.push(`${spec.file}: expected at least ${spec.minCount} devices, got ${parsed.length}`);
  }

  for (let i = 0; i < parsed.length; i++) {
    const d = parsed[i];
    const ctx = `${spec.file}[${i}] (${d?.id ?? 'unknown'})`;

    if (!d || typeof d !== 'object') {
      errors.push(`${ctx}: must be an object`);
      continue;
    }

    if (typeof d.id !== 'string' || !d.id.trim()) {
      errors.push(`${ctx}: invalid id`);
    } else if (seenIds.has(d.id)) {
      errors.push(`${ctx}: duplicate id "${d.id}"`);
    } else {
      seenIds.add(d.id);
    }

    if (typeof d.label !== 'string' || !d.label.trim()) {
      errors.push(`${ctx}: invalid label`);
    }

    if (d.platform !== spec.platform) {
      errors.push(`${ctx}: platform "${d.platform}" does not match "${spec.platform}"`);
    }

    if (typeof d.osVersion !== 'string' || !d.osVersion.trim()) {
      errors.push(`${ctx}: invalid osVersion`);
    }

    if (typeof d.mobile !== 'boolean') {
      errors.push(`${ctx}: mobile must be boolean`);
    } else if ((spec.platform === 'android' || spec.platform === 'ios') && !d.mobile) {
      errors.push(`${ctx}: mobile must be true for ${spec.platform}`);
    } else if (
      (spec.platform === 'windows' || spec.platform === 'macos' || spec.platform === 'linux') &&
      d.mobile
    ) {
      errors.push(`${ctx}: mobile must be false for ${spec.platform}`);
    }

    if (
      !d.screen ||
      typeof d.screen.width !== 'number' ||
      d.screen.width <= 0 ||
      typeof d.screen.height !== 'number' ||
      d.screen.height <= 0 ||
      typeof d.screen.dpr !== 'number' ||
      d.screen.dpr <= 0
    ) {
      errors.push(`${ctx}: invalid screen`);
    }

    if (
      !d.viewport ||
      typeof d.viewport.width !== 'number' ||
      d.viewport.width <= 0 ||
      typeof d.viewport.height !== 'number' ||
      d.viewport.height <= 0
    ) {
      errors.push(`${ctx}: invalid viewport`);
    }

    if (
      !d.hardware ||
      typeof d.hardware.cores !== 'number' ||
      d.hardware.cores <= 0 ||
      typeof d.hardware.memory !== 'number' ||
      d.hardware.memory <= 0
    ) {
      errors.push(`${ctx}: invalid hardware`);
    }

    if (
      !d.gpu ||
      typeof d.gpu.vendor !== 'string' ||
      !d.gpu.vendor.trim() ||
      typeof d.gpu.renderer !== 'string' ||
      !d.gpu.renderer.trim()
    ) {
      errors.push(`${ctx}: invalid gpu`);
    } else {
      const r = d.gpu.renderer;
      if (spec.platform === 'windows' && !r.includes('Direct3D11') && !r.includes('ANGLE')) {
        errors.push(`${ctx}: Windows GPU renderer should use ANGLE/Direct3D11, got "${r}"`);
      }
      if (spec.platform === 'macos' && r.includes('Direct3D11')) {
        errors.push(`${ctx}: macOS GPU renderer must not include Direct3D11`);
      }
      if (spec.platform === 'android' && !/(Adreno|Mali|Xclipse|PowerVR)/i.test(r)) {
        errors.push(`${ctx}: Android GPU renderer should be mobile GPU, got "${r}"`);
      }
      if (spec.platform === 'ios' && !/Apple/i.test(r)) {
        errors.push(`${ctx}: iOS GPU renderer should be Apple GPU, got "${r}"`);
      }
    }

    if (!d.touch || typeof d.touch.maxTouchPoints !== 'number' || d.touch.maxTouchPoints < 0) {
      errors.push(`${ctx}: invalid touch.maxTouchPoints`);
    } else if (d.mobile && d.touch.maxTouchPoints < 1) {
      errors.push(`${ctx}: mobile device must have maxTouchPoints >= 1`);
    }

    if (!Array.isArray(d.fonts) || d.fonts.length === 0) {
      errors.push(`${ctx}: fonts must be a non-empty array`);
    }

    if (typeof d.uaTemplate !== 'string' || !d.uaTemplate.trim()) {
      errors.push(`${ctx}: invalid uaTemplate`);
    } else if (spec.platform !== 'ios' && !d.uaTemplate.includes('{CHROME_VERSION}')) {
      errors.push(`${ctx}: uaTemplate must include {CHROME_VERSION} placeholder`);
    }

    if (spec.platform === 'ios') {
      if (d.clientHints !== null) {
        errors.push(`${ctx}: iOS devices must have clientHints: null`);
      }
    } else {
      const ch = d.clientHints;
      if (
        !ch ||
        typeof ch.platform !== 'string' ||
        typeof ch.platformVersion !== 'string' ||
        typeof ch.architecture !== 'string' ||
        typeof ch.bitness !== 'string' ||
        typeof ch.model !== 'string' ||
        typeof ch.mobile !== 'boolean'
      ) {
        errors.push(`${ctx}: invalid clientHints`);
      } else if (ch.mobile !== d.mobile) {
        errors.push(`${ctx}: clientHints.mobile does not match device.mobile`);
      }
    }

    totalCount++;
  }
}

if (errors.length > 0) {
  console.error(`Device catalog validation failed with ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `Device catalog OK: validated ${totalCount} devices across ${EXPECTED_FILES.length} platforms.`,
);
