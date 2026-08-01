/**
 * Generates the extension icons.
 *
 * The mark is a proofreader's check in Skillo's proof blue on ink — the same
 * idea the diff view uses to show what was touched. Written by hand rather than
 * pulled from a design tool so the icons can be regenerated from source.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// WXT resolves publicDir against the project root, not srcDir.
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];

const INK = [0x17, 0x16, 0x1a];
const PROOF = [0x4d, 0xa6, 0xcc];

/* ------------------------------------------------------------- PNG writing */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: compression, filter, interlace — all 0

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- geometry */

/** Distance from a point to a line segment, all in normalized units. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Signed distance to a rounded square, negative inside. */
function roundedSquare(px, py, half, radius) {
  const qx = Math.abs(px - 0.5) - (half - radius);
  const qy = Math.abs(py - 0.5) - (half - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  );
}

function mix(a, b, t) {
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  // Antialias over roughly one pixel, expressed in normalized units.
  const feather = 1 / size;
  const strokeHalfWidth = 0.075;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at pixel centres.
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;

      const plate = roundedSquare(px, py, 0.47, 0.12);
      const plateAlpha = clamp01(0.5 - plate / feather);

      const check = Math.min(
        distanceToSegment(px, py, 0.26, 0.52, 0.44, 0.70),
        distanceToSegment(px, py, 0.44, 0.70, 0.76, 0.31),
      );
      const checkAlpha = clamp01(0.5 + (strokeHalfWidth - check) / feather);

      const colour = mix(INK, PROOF, checkAlpha);
      const offset = (y * size + x) * 4;
      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = Math.round(plateAlpha * 255);
    }
  }

  return pixels;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
