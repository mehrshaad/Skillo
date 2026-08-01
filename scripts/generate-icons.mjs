/**
 * Generates the extension icons.
 *
 * The mark is two stacked bars on an ink plate: a short muted one above a
 * longer, heavier one in Skillo's proof blue — a resume line, strengthened.
 * Two solid shapes survive 16px far better than a thin check does. Written by
 * hand rather than pulled from a design tool so the icons regenerate from
 * source.
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

const INK = [0x10, 0x10, 0x14];
const PROOF = [0x5a, 0xb4, 0xdc];
const PAPER = [0xe8, 0xe4, 0xdb];

/** Each bar: y centre, half-length either side of centre, half-thickness. */
// Spacing is chosen so the gap survives 16px as a clear 2px band; verified by
// decoding the generated PNG, not by eye.
const BARS = [
  { y: 0.35, halfLength: 0.2, halfThickness: 0.05, colour: PAPER },
  { y: 0.625, halfLength: 0.31, halfThickness: 0.065, colour: PROOF },
];

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

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at pixel centres.
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;

      const plate = roundedSquare(px, py, 0.47, 0.12);
      const plateAlpha = clamp01(0.5 - plate / feather);

      // Paint the bars over the plate in order, so the lower one wins overlaps.
      let colour = INK;
      for (const bar of BARS) {
        const distance = distanceToSegment(
          px,
          py,
          0.5 - bar.halfLength,
          bar.y,
          0.5 + bar.halfLength,
          bar.y,
        );
        colour = mix(colour, bar.colour, clamp01(0.5 + (bar.halfThickness - distance) / feather));
      }

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
