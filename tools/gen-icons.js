// Dependency-free PNG app-icon generator for Connectik's "Infinite Link" logo:
// an indigo squircle with two interlocking rounded-rect links (white + mint
// gradient) and a white center hub. Encodes PNG via zlib — no npm deps.
//   node tools/gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INDIGO = [0x4f, 0x46, 0xe5];
const WHITE = [255, 255, 255];
const MINT_A = [0x34, 0xd3, 0x99]; // #34d399
const MINT_B = [0x05, 0x96, 0x69]; // #059669

// ---- PNG encoding ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Geometry (in 512-design space) ----
function insideRR(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const rx0 = x + r, rx1 = x + w - r, ry0 = y + r, ry1 = y + h - r;
  let cx, cy;
  if (px < rx0 && py < ry0) { cx = rx0; cy = ry0; }
  else if (px > rx1 && py < ry0) { cx = rx1; cy = ry0; }
  else if (px < rx0 && py > ry1) { cx = rx0; cy = ry1; }
  else if (px > rx1 && py > ry1) { cx = rx1; cy = ry1; }
  else return true;
  const dx = px - cx, dy = py - cy; return dx * dx + dy * dy <= r * r;
}
// Rounded-rect stroke ("ring"): inside outer edge AND outside inner edge.
function inRing(px, py, x, y, w, h, r, sw) {
  const hw = sw / 2;
  const outer = insideRR(px, py, x - hw, y - hw, w + 2 * hw, h + 2 * hw, r + hw);
  if (!outer) return false;
  const inner = insideRR(px, py, x + hw, y + hw, w - 2 * hw, h - 2 * hw, Math.max(0, r - hw));
  return !inner;
}
function lerp(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }

function renderIcon(S, { maskable }) {
  const rgba = Buffer.alloc(S * S * 4);
  const SS = 4;                       // supersample
  const t = maskable ? 0.72 : 1.0;    // logo content scale (safe zone for maskable)
  const cx = S / 2;
  const scale = S / 512;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let bgCov = 0, leftCov = 0, rightCov = 0, dotCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ox = px + (sx + 0.5) / SS;
          const oy = py + (sy + 0.5) / SS;
          // map output px -> 512 design coord (scaled around center)
          const u = (ox - cx) / scale / t + 256;
          const v = (oy - cx) / scale / t + 256;
          // background
          if (maskable) bgCov += 1; // full bleed indigo
          else bgCov += insideRR(ox / scale, oy / scale, 32, 32, 448, 448, 128) ? 1 : 0;
          // links (stroke width 32 in design space)
          if (inRing(u, v, 136, 196, 140, 120, 60, 32)) leftCov += 1;
          if (inRing(u, v, 236, 196, 140, 120, 60, 32)) rightCov += 1;
          // center hub
          const dx = u - 256, dy = v - 256;
          if (dx * dx + dy * dy <= 14 * 14) dotCov += 1;
        }
      }
      const n = SS * SS;
      bgCov /= n; leftCov /= n; rightCov /= n; dotCov /= n;
      // composite: indigo bg, then mint right link, then white left link + dot
      let r = INDIGO[0], g = INDIGO[1], b = INDIGO[2];
      // right (mint) link — gradient by horizontal position
      if (rightCov > 0) {
        const gt = Math.max(0, Math.min(1, (236 + 70 - 136) / 240));
        const mint = lerp(MINT_A, MINT_B, gt);
        r = r * (1 - rightCov) + mint[0] * rightCov;
        g = g * (1 - rightCov) + mint[1] * rightCov;
        b = b * (1 - rightCov) + mint[2] * rightCov;
      }
      const whiteCov = Math.max(leftCov, dotCov);
      if (whiteCov > 0) {
        r = r * (1 - whiteCov) + 255 * whiteCov;
        g = g * (1 - whiteCov) + 255 * whiteCov;
        b = b * (1 - whiteCov) + 255 * whiteCov;
      }
      const o = (py * S + px) * 4;
      rgba[o] = Math.round(r); rgba[o + 1] = Math.round(g); rgba[o + 2] = Math.round(b);
      rgba[o + 3] = Math.round(255 * bgCov);
    }
  }
  return encodePNG(S, S, rgba);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
// Versioned filenames ("-ck1") so a rebrand bypasses every cache layer
// (browser HTTP cache, service worker, and the Android WebAPK icon cache).
const targets = [
  ['icon-192-ck1.png', 192, { maskable: false }],
  ['icon-512-ck1.png', 512, { maskable: false }],
  ['icon-maskable-192-ck1.png', 192, { maskable: true }],
  ['icon-maskable-512-ck1.png', 512, { maskable: true }],
  ['apple-touch-icon-ck1.png', 180, { maskable: true }],
  ['favicon-32-ck1.png', 32, { maskable: false }],
];
for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(outDir, name), renderIcon(size, opts));
  console.log('✓', name);
}
console.log('Done -> public/icons/');
