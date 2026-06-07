// Dependency-free PNG app-icon generator for Pronet's PWA.
// Renders a brand "P" mark (white, anti-aliased) on an indigo background and
// writes the icon set into public/icons/. No npm deps — encodes PNG via zlib.
//   node tools/gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND = [0x4f, 0x46, 0xe5];      // #4f46e5 indigo
const BRAND_DARK = [0x3f, 0x37, 0xc9]; // subtle gradient bottom
const WHITE = [255, 255, 255];

// ---- PNG encoding ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter byte 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- Geometry coverage (supersampled AA) ----
function insideRoundedRect(x, y, S, radius) {
  const r = radius;
  if (r <= 0) return (x >= 0 && x <= S && y >= 0 && y <= S) ? 1 : 0;
  if (x >= r && x <= S - r) return (y >= 0 && y <= S) ? 1 : 0;
  if (y >= r && y <= S - r) return (x >= 0 && x <= S) ? 1 : 0;
  const cx = x < r ? r : S - r;
  const cy = y < r ? r : S - r;
  const dx = x - cx, dy = y - cy;
  return (dx * dx + dy * dy) <= r * r ? 1 : 0;
}
function insideP(x, y, S) {
  const cx = S * 0.5, cy = S * 0.5;
  const lx = cx - S * 0.17, sw = S * 0.135;
  const ty = cy - S * 0.30, by = cy + S * 0.30;
  const inStem = (x >= lx && x <= lx + sw && y >= ty && y <= by);
  const Ro = S * 0.205, Ri = S * 0.085;
  const cxB = lx + sw * 0.5, cyB = ty + Ro;
  const d = Math.sqrt((x - cxB) * (x - cxB) + (y - cyB) * (y - cyB));
  const inRing = (d >= Ri && d <= Ro && x >= cxB - sw * 0.5);
  return inStem || inRing;
}

function renderIcon(S, { maskable }) {
  const rgba = Buffer.alloc(S * S * 4);
  const SS = 4; // supersample grid
  const radius = maskable ? 0 : S * 0.22;
  const pScale = maskable ? 0.74 : 1.0; // shrink into safe zone for maskable
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let bgCov = 0, pCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          bgCov += insideRoundedRect(x, y, S, radius);
          const xx = (x - S / 2) / pScale + S / 2;
          const yy = (y - S / 2) / pScale + S / 2;
          pCov += insideP(xx, yy, S) ? 1 : 0;
        }
      }
      const n = SS * SS;
      bgCov /= n; pCov /= n;
      const t = py / S;
      const bg = [
        Math.round(BRAND[0] * (1 - t) + BRAND_DARK[0] * t),
        Math.round(BRAND[1] * (1 - t) + BRAND_DARK[1] * t),
        Math.round(BRAND[2] * (1 - t) + BRAND_DARK[2] * t),
      ];
      let r = bg[0], g = bg[1], b = bg[2];
      r = r * (1 - pCov) + WHITE[0] * pCov;
      g = g * (1 - pCov) + WHITE[1] * pCov;
      b = b * (1 - pCov) + WHITE[2] * pCov;
      const o = (py * S + px) * 4;
      rgba[o] = Math.round(r); rgba[o + 1] = Math.round(g); rgba[o + 2] = Math.round(b);
      rgba[o + 3] = Math.round(255 * Math.max(bgCov, pCov));
    }
  }
  return encodePNG(S, S, rgba);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-192.png', 192, { maskable: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
  ['favicon-32.png', 32, { maskable: false }],
];
for (const [name, size, opts] of targets) {
  const buf = renderIcon(size, opts);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log('✓', name, `(${size}x${size}, ${buf.length} bytes)`);
}
console.log('Done -> public/icons/');
