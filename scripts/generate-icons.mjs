/**
 * Generates the extension icons.
 *
 * The mark is a bold S beside three skill bullets on a white rounded plate:
 * the letter carries the name, the bullets say the subject is a resume. Two
 * elements is the most that survives 16px, which is the size that actually
 * matters — a toolbar icon is read at a glance or not at all.
 *
 * The S is built from two elliptical annulus arcs rather than a font, since
 * there is no text rasteriser here. Each bowl keeps a different horizontal and
 * vertical thickness, which is what gives a bold S its stress; a uniform stroke
 * reads as a ribbon.
 *
 * Geometry and palette were measured off the chosen concept tile, so the
 * constants below are in that tile's normalized coordinates and `MARK_SCALE`
 * enlarges the whole composition to use more of the plate.
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

const PLATE_FILL = [0xff, 0xff, 0xff];
const NAVY = [0x10, 0x21, 0x3d];
const TEAL = [0x2a, 0xc0, 0xb6];

/** Samples per axis; 8 means 64 samples per output pixel. */
const SUPERSAMPLE = 8;

/* ------------------------------------------------------------------ shapes */

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Angle in degrees, 0 = right, 90 = below, measured with y pointing down. */
function angleAt(px, py, cx, cy) {
  const deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

function inSpan(angle, spans) {
  return spans.some(([from, to]) => angle >= from && angle <= to);
}

/**
 * One bowl of the S: the band between two concentric ellipses, cut down to the
 * angular spans that the letter actually draws.
 */
function inBowl(px, py, bowl) {
  const dx = (px - bowl.cx) / bowl.a;
  const dy = (py - bowl.cy) / bowl.b;
  if (dx * dx + dy * dy > 1) return false;

  const ix = (px - bowl.cx) / bowl.ai;
  const iy = (py - bowl.cy) / bowl.bi;
  if (ix * ix + iy * iy < 1) return false;

  return inSpan(angleAt(px, py, bowl.cx, bowl.cy), bowl.spans);
}

/** A horizontal bar with fully rounded ends. */
function inBar(px, py, x1, x2, cy, halfH) {
  return roundedRect(px, py, (x1 + x2) / 2, cy, (x2 - x1) / 2, halfH, halfH) <= 0;
}

/* ---------------------------------------------------------------- geometry */

const PLATE = { cx: 0.5, cy: 0.5, half: 0.485, radius: 0.15 };

/** Enlarges the measured composition about its own centre to fill the plate. */
const MARK_SCALE = 1.12;
const MARK_CENTRE_Y = 0.479;

const S_CX = 0.309;
/**
 * Outer semi-axes, then the counter's. The bowls are taller than half the
 * letter on purpose: they have to overlap vertically or the waist meets at a
 * single point and the S pinches in two.
 */
const BOWL = { a: 0.158, b: 0.132, ai: 0.07, bi: 0.075 };

const UPPER = {
  ...BOWL,
  cx: S_CX,
  cy: 0.382,
  // Waist, up the left, over the top, out to the top-right terminal.
  spans: [[90, 342]],
};
const LOWER = {
  ...BOWL,
  cx: S_CX,
  cy: 0.5763,
  // Waist, round the right, across the bottom, to the lower-left terminal.
  spans: [
    [270, 360],
    [0, 162],
  ],
};

const ROWS = [0.316, 0.4774, 0.6389];
const DOT = { cx: 0.5938, r: 0.0399 };
const BAR = { x1: 0.6806, x2: 0.8542, halfH: 0.0243 };

/**
 * Below this size the bullet dots land on less than a pixel and the rows blur
 * into one pale block, so the small icon drops them, runs each bar back to
 * where its dot was, and thickens it. Optical sizing, not a different mark.
 */
const SMALL_SIZE = 20;
const SMALL = { scale: 1.22, x1: DOT.cx - DOT.r, halfH: 0.032 };

/** Colour at one sample point, or null where nothing is drawn. */
function sampleAt(px, py, small) {
  if (roundedRect(px, py, PLATE.cx, PLATE.cy, PLATE.half, PLATE.half, PLATE.radius) > 0) {
    return null;
  }

  // Into the coordinates the constants above were measured in.
  const scale = small ? SMALL.scale : MARK_SCALE;
  const x = 0.5 + (px - 0.5) / scale;
  const y = MARK_CENTRE_Y + (py - 0.5) / scale;

  if (inBowl(x, y, UPPER) || inBowl(x, y, LOWER)) return NAVY;

  const x1 = small ? SMALL.x1 : BAR.x1;
  const halfH = small ? SMALL.halfH : BAR.halfH;
  for (const cy of ROWS) {
    if (!small && Math.hypot(x - DOT.cx, y - cy) <= DOT.r) return TEAL;
    if (inBar(x, y, x1, BAR.x2, cy, halfH)) return TEAL;
  }

  return PLATE_FILL;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  const small = size <= SMALL_SIZE;

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
          const colour = sampleAt(px, py, small);
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
