/**
 * Reproducible app icon generator — no image libraries, no binary assets committed by hand.
 * Writes `build/icon.png` (512×512 RGBA); electron-builder converts it to .ico for Windows.
 *
 * Run with `npm run icon`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 512;
const SAMPLES = 3; // 3×3 supersampling for clean anti-aliased edges

const BG_TOP = [26, 35, 64];
const BG_BOTTOM = [10, 13, 22];
const STAR_INNER = [222, 231, 255];
const STAR_OUTER = [111, 141, 255];
const GLOW = [86, 112, 255];

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Rounded-box signed distance; negative inside. */
function roundedBox(x, y, half, radius) {
  const qx = Math.abs(x) - (half - radius);
  const qy = Math.abs(y) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Four-cusp star (astroid family): |x|^p + |y|^p <= r^p. */
function star(x, y, radius, power) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return Math.pow(ax / radius, power) + Math.pow(ay / radius, power);
}

function sample(x, y) {
  const box = roundedBox(x, y, 0.985, 0.2);
  if (box > 0) return [0, 0, 0, 0];

  const vertical = clamp01((y + 1) / 2);
  let rgb = mix(BG_TOP, BG_BOTTOM, vertical);

  // Soft glow behind the mark.
  const glow = Math.max(0, 1 - Math.hypot(x, y) / 0.95);
  rgb = mix(rgb, GLOW, glow * glow * 0.28);

  const diagonal = (x + y) * Math.SQRT1_2;
  const antidiagonal = (x - y) * Math.SQRT1_2;
  const primary = star(x, y, 0.7, 0.55);
  const secondary = star(diagonal * 1.18, antidiagonal * 1.18, 0.34, 0.55);
  const mark = Math.min(primary, secondary);
  if (mark <= 1) {
    const t = clamp01(Math.hypot(x, y) / 0.7);
    rgb = mix(STAR_INNER, STAR_OUTER, t);
  }

  // Subtle inner rim so the tile reads as a tile on light and dark backgrounds.
  if (box > -0.018) rgb = mix(rgb, [255, 255, 255], 0.16);

  return [rgb[0], rgb[1], rgb[2], 255];
}

function render() {
  const stride = SIZE * 4;
  const raw = Buffer.alloc(stride * SIZE + SIZE); // one filter byte per scanline
  for (let y = 0; y < SIZE; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    for (let x = 0; x < SIZE; x++) {
      const accum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = ((x + (sx + 0.5) / SAMPLES) / SIZE) * 2 - 1;
          const py = ((y + (sy + 0.5) / SAMPLES) / SIZE) * 2 - 1;
          const [r, g, b, a] = sample(px, py);
          accum[0] += r * a;
          accum[1] += g * a;
          accum[2] += b * a;
          accum[3] += a;
        }
      }
      const count = SAMPLES * SAMPLES;
      const alpha = accum[3] / count;
      const offset = y * (stride + 1) + 1 + x * 4;
      if (alpha <= 0) {
        raw[offset] = raw[offset + 1] = raw[offset + 2] = raw[offset + 3] = 0;
      } else {
        const weight = accum[3] / 255;
        raw[offset] = Math.round(accum[0] / weight);
        raw[offset + 1] = Math.round(accum[1] / weight);
        raw[offset + 2] = Math.round(accum[2] / weight);
        raw[offset + 3] = Math.round(alpha);
      }
    }
  }
  return raw;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png(render()));
console.log(`wrote build/icon.png (${SIZE}×${SIZE})`);
