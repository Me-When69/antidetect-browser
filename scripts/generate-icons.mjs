import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '..', 'build', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const FACET_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Facet">
  <rect width="64" height="64" rx="14" fill="#0E1116"/>
  <g stroke="#0E1116" stroke-width="2" stroke-linejoin="round">
    <polygon points="32,6 54,19 32,32 10,19" fill="#2DD4BF"/>
    <polygon points="10,19 32,32 32,58 10,45" fill="#7C5CFF"/>
    <polygon points="32,32 54,19 54,45 32,58" fill="#4B33C9"/>
  </g>
</svg>
`;

fs.writeFileSync(path.join(outDir, 'icon.svg'), FACET_SVG, 'utf8');

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1];
    const xj = poly[j][0],
      yj = poly[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function inRoundedRect(x, y, size, r) {
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
  if (x > size - r && y < r) return (x - (size - r)) ** 2 + (y - r) ** 2 <= r * r;
  if (x < r && y > size - r) return (x - r) ** 2 + (y - (size - r)) ** 2 <= r * r;
  if (x > size - r && y > size - r) return (x - (size - r)) ** 2 + (y - (size - r)) ** 2 <= r * r;
  return true;
}

const POLY_TOP = [
  [32, 6],
  [54, 19],
  [32, 32],
  [10, 19],
];
const POLY_LEFT = [
  [10, 19],
  [32, 32],
  [32, 58],
  [10, 45],
];
const POLY_RIGHT = [
  [32, 32],
  [54, 19],
  [54, 45],
  [32, 58],
];

const C_BG = [0x0e, 0x11, 0x16, 0xff];
const C_TOP = [0x2d, 0xd4, 0xbf, 0xff];
const C_LEFT = [0x7c, 0x5c, 0xff, 0xff];
const C_RIGHT = [0x4b, 0x33, 0xc9, 0xff];

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const radius = size * (14 / 64);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5, size, radius)) {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
        continue;
      }
      const nx = ((x + 0.5) / size) * 64;
      const ny = ((y + 0.5) / size) * 64;
      let color = C_BG;
      if (pointInPoly(nx, ny, POLY_TOP)) color = C_TOP;
      else if (pointInPoly(nx, ny, POLY_LEFT)) color = C_LEFT;
      else if (pointInPoly(nx, ny, POLY_RIGHT)) color = C_RIGHT;
      raw[idx] = color[0];
      raw[idx + 1] = color[1];
      raw[idx + 2] = color[2];
      raw[idx + 3] = color[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIco(pngEntries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngEntries.length, 4);

  const dirEntries = [];
  let offset = 6 + pngEntries.length * 16;
  for (const { size, buf } of pngEntries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buf.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.buf)]);
}

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const icoEntries = [];
for (const s of sizes) {
  const buf = renderPng(s);
  fs.writeFileSync(path.join(outDir, `${s}x${s}.png`), buf);
  if (s <= 256) {
    icoEntries.push({ size: s, buf });
  }
}
fs.copyFileSync(path.join(outDir, '512x512.png'), path.join(outDir, 'icon.png'));
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(icoEntries));
console.log(`Generated Facet icons in ${outDir} (svg, png 16..1024, icon.png, icon.ico).`);
