/**
 * Builds the extension icons from the master artwork.
 *
 * This does not draw anything. It takes `icon20.png` exactly as it is, rounds
 * the corners, and resizes it to the sizes the manifest asks for. Keeping the
 * step scripted rather than doing it by hand means the icons can be rebuilt
 * from the master at any time, and the master stays the single source of truth.
 *
 * The corners are masked at full resolution and the downscale is a true area
 * average, so the rounding antialiases itself on the way down — no separate
 * smoothing pass, and no blurring of the artwork.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = join(ROOT, 'icon20.png');
// WXT resolves publicDir against the project root, not srcDir.
const OUT_DIR = join(ROOT, 'public', 'icon');
const SIZES = [16, 32, 48, 128];

/** Corner radius as a fraction of the side. */
const RADIUS = 0.18;

/* ------------------------------------------------------------ PNG decoding */

function readChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  const chunks = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: buf.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Returns { width, height, pixels } with pixels as RGBA bytes. */
function decodePng(buf) {
  const chunks = readChunks(buf);

  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('no IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const colourType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)),
  );

  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? lines[dst + i - channels] : 0;
      const b = y > 0 ? lines[up + i] : 0;
      const c = y > 0 && i >= channels ? lines[up + i - channels] : 0;

      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paeth(a, b, c); break;
        default: throw new Error(`unknown filter ${filter} on row ${y}`);
      }
      lines[dst + i] = value & 0xff;
    }
  }

  // Normalize whatever came in to RGBA.
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels === 4) {
      lines.copy(pixels, d, s, s + 4);
    } else if (channels === 3) {
      pixels[d] = lines[s];
      pixels[d + 1] = lines[s + 1];
      pixels[d + 2] = lines[s + 2];
      pixels[d + 3] = 255;
    } else if (channels === 2) {
      pixels.fill(lines[s], d, d + 3);
      pixels[d + 3] = lines[s + 1];
    } else {
      pixels.fill(lines[s], d, d + 3);
      pixels[d + 3] = 255;
    }
  }

  return { width, height, pixels };
}

/* ---------------------------------------------------------- mask and scale */

/** Clears everything outside a rounded square, in place. */
function roundCorners(image) {
  const { width: w, height: h, pixels } = image;
  const radius = Math.min(w, h) * RADIUS;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Distance past the straight edges, i.e. how far into a corner we are.
      const dx = Math.abs(x + 0.5 - w / 2) - (w / 2 - radius);
      const dy = Math.abs(y + 0.5 - h / 2) - (h / 2 - radius);
      if (dx <= 0 || dy <= 0) continue;
      if (Math.hypot(dx, dy) > radius) pixels[(y * w + x) * 4 + 3] = 0;
    }
  }
}

/**
 * Area-average resample. Every source pixel contributes in proportion to how
 * much of it the output pixel covers, which is the right filter for a large
 * reduction — and it is what antialiases the masked corners.
 */
function resize(image, size) {
  const { width: sw, height: sh, pixels: src } = image;
  const out = Buffer.alloc(size * size * 4);
  const scaleX = sw / size;
  const scaleY = sh / size;

  for (let oy = 0; oy < size; oy++) {
    const y0 = oy * scaleY;
    const y1 = y0 + scaleY;

    for (let ox = 0; ox < size; ox++) {
      const x0 = ox * scaleX;
      const x1 = x0 + scaleX;

      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      let weight = 0;

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          const w = wx * wy;
          const i = (sy * sw + sx) * 4;
          // Premultiplied, so transparent pixels cannot tint the edge.
          const a = src[i + 3] / 255;
          r += src[i] * a * w;
          g += src[i + 1] * a * w;
          b += src[i + 2] * a * w;
          alpha += a * w;
          weight += w;
        }
      }

      const o = (oy * size + ox) * 4;
      if (alpha > 0) {
        out[o] = Math.round(r / alpha);
        out[o + 1] = Math.round(g / alpha);
        out[o + 2] = Math.round(b / alpha);
      }
      out[o + 3] = Math.round((alpha / weight) * 255);
    }
  }

  return out;
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

const master = decodePng(readFileSync(MASTER));
console.log(`master ${master.width}x${master.height}`);
roundCorners(master);

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, encodePng(size, resize(master, size)));
  console.log(`wrote ${file}`);
}
