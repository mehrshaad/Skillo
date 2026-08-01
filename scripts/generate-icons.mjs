/**
 * Generates the extension icons.
 *
 * The mark is a résumé page with a bolt cutting across its lower corner: the
 * page says what Skillo works on, the bolt says it happens in one pass. Two
 * shapes is the most that survives 16px, which is the size that actually
 * matters — a toolbar icon is read at a glance or not at all. For the same
 * reason the page carries two thick rules rather than three thin ones, which
 * turn into a grey smear when they are two pixels apart.
 *
 * Everything is rasterised by supersampling hard-edged shape tests, so the
 * antialiasing is uniform and no per-shape distance maths is needed.
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
const PAPER = [0xf4, 0xf1, 0xea];
const RULE = [0x9a, 0x94, 0x8a];
const PROOF = [0x5a, 0xb4, 0xdc];

/** Samples per axis; 4 means 16 samples per output pixel. */
const SUPERSAMPLE = 4;

/* ------------------------------------------------------------------ shapes */

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance to a polygon's outline, used to grow an even moat around it. */
function distToPolygon(px, py, points) {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    best = Math.min(
      best,
      distToSegment(px, py, points[j][0], points[j][1], points[i][0], points[i][1]),
    );
  }
  return best;
}

/* ---------------------------------------------------------------- geometry */

const PLATE = { cx: 0.5, cy: 0.5, half: 0.47, radius: 0.13 };
/** Page pushed up-left, leaving the lower-right corner for the bolt. */
const PAGE = { cx: 0.425, cy: 0.43, halfW: 0.205, halfH: 0.285, radius: 0.045 };

const BOLT = [
  [0.795, 0.505],
  [0.575, 0.755],
  [0.715, 0.76],
  [0.6, 0.945],
  [0.865, 0.665],
  [0.725, 0.66],
];
/** A moat of plate around the bolt, so it never merges into the page. */
const BOLT_MOAT = 0.055;

const LINES = [
  { y: 0.26, x1: 0.272, x2: 0.57 },
  { y: 0.395, x1: 0.272, x2: 0.47 },
];
const LINE_HALF_HEIGHT = 0.037;

/** Colour at one sample point, or null where nothing is drawn. */
function sampleAt(px, py) {
  if (roundedRect(px, py, PLATE.cx, PLATE.cy, PLATE.half, PLATE.half, PLATE.radius) > 0) {
    return null;
  }

  if (inPolygon(px, py, BOLT)) return PROOF;
  if (distToPolygon(px, py, BOLT) <= BOLT_MOAT) return INK;

  const onPage =
    roundedRect(px, py, PAGE.cx, PAGE.cy, PAGE.halfW, PAGE.halfH, PAGE.radius) <= 0;
  if (!onPage) return INK;

  for (const line of LINES) {
    if (px >= line.x1 && px <= line.x2 && Math.abs(py - line.y) <= LINE_HALF_HEIGHT) {
      return RULE;
    }
  }

  return PAPER;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = (x * SUPERSAMPLE + sx + 0.5) * step;
          const py = (y * SUPERSAMPLE + sy + 0.5) * step;
          const colour = sampleAt(px, py);
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          covered++;
        }
      }

      const offset = (y * size + x) * 4;
      const total = SUPERSAMPLE * SUPERSAMPLE;
      if (covered > 0) {
        pixels[offset] = Math.round(r / covered);
        pixels[offset + 1] = Math.round(g / covered);
        pixels[offset + 2] = Math.round(b / covered);
        pixels[offset + 3] = Math.round((covered / total) * 255);
      }
    }
  }

  return pixels;
}

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

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
