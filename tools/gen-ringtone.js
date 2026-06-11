// Generates public/ringtone.wav — an original marimba-style melodic ringtone
// (warm mallet pluck, in the familiar style of modern phone defaults, but an
// original tune: no copyrighted audio is copied). calls.js loops the file.
// 16-bit PCM mono 22050 Hz. Re-run any time: node tools/gen-ringtone.js
const fs = require('fs');
const path = require('path');

const RATE = 22050;

// Marimba-ish pluck: a few harmonics with fast exponential decay + soft attack.
function pluck(samples, startSec, freq, durSec, vol) {
  const start = Math.round(startSec * RATE);
  const len = Math.round(durSec * RATE);
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const attack = Math.min(1, i / (0.004 * RATE));
    const decay = Math.exp(-t * 6.5);
    const v =
      1.00 * Math.sin(2 * Math.PI * freq * t) +
      0.45 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 9) +
      0.18 * Math.sin(2 * Math.PI * freq * 4 * t) * Math.exp(-t * 13);
    const idx = start + i;
    if (idx < samples.length) samples[idx] += v * attack * decay * vol;
  }
}

const N = {
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
  C6: 1046.5, E6: 1318.5, G4: 392.0, A4: 440.0, B4: 493.88,
};

// One bar of a bouncy, friendly motif (~2.4s) followed by a short rest, played
// twice (~6s loop). Original melody in C major pentatonic.
const motif = [
  [0.00, N.C5, 0.9], [0.20, N.E5, 0.8], [0.40, N.G5, 0.9], [0.60, N.E5, 0.7],
  [0.80, N.A5, 0.9], [1.00, N.G5, 0.8], [1.20, N.E5, 0.7], [1.40, N.C5, 0.8],
  [1.60, N.D5, 0.8], [1.80, N.E5, 0.9], [2.00, N.G5, 1.0],
  // light bass underneath
  [0.00, N.C5 / 2, 0.5], [0.80, N.A4, 0.45], [1.60, N.G4, 0.45],
];

const BAR_S = 2.95;       // motif + breathing room
const LOOPS = 2;
const total = Math.round(BAR_S * LOOPS * RATE);
const mix = new Float64Array(total);

for (let l = 0; l < LOOPS; l++) {
  for (const [at, f, v] of motif) pluck(mix, l * BAR_S + at, f, 1.2, v * 0.55);
}

// Normalize to -1.5 dB and clamp.
let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
const gain = peak ? (0.84 / peak) : 1;

const samples = new Int16Array(total);
for (let i = 0; i < total; i++) {
  samples[i] = Math.max(-32768, Math.min(32767, Math.round(mix[i] * gain * 32767)));
}

const dataSize = samples.length * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
Buffer.from(samples.buffer).copy(buf, 44);

const out = path.join(__dirname, '..', 'public', 'ringtone.wav');
fs.writeFileSync(out, buf);
console.log('wrote', out, (buf.length / 1024).toFixed(0) + ' KB,', (total / RATE).toFixed(1) + 's loop');
