#!/usr/bin/env node
/**
 * Generates the PWA icons into public/.
 *
 * Hand-rolled PNG encoder rather than a dependency: offline is a first-class
 * requirement, every dependency is bundle weight or supply-chain surface, and
 * this needs to run exactly once per icon change. zlib is in the standard
 * library, so the whole thing is about sixty lines.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public');
mkdirSync(out, { recursive: true });

const BG = [0x15, 0x15, 0x27];
const FG = [0xf2, 0xb0, 0x35];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode RGBA pixel data as a PNG. */
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distance from p to the segment ab. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inTriangle(px, py, tri) {
  const sign = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(px, py, tri[0], tri[1], tri[2], tri[3]);
  const d2 = sign(px, py, tri[2], tri[3], tri[4], tri[5]);
  const d3 = sign(px, py, tri[4], tri[5], tri[0], tri[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * A single game piece: an L-bend polyline with an arrowhead, which is the one
 * shape that says what this app is at 48px.
 *
 * `inset` shrinks the glyph for maskable icons, whose outer 10% can be cropped
 * to any shape the platform likes.
 */
function glyphCoverage(u, v, inset) {
  const c = (x) => 0.5 + (x - 0.5) * inset;
  const r = 0.055 * inset;
  const shaft =
    distToSegment(u, v, c(0.32), c(0.74), c(0.32), c(0.5)) <= r ||
    distToSegment(u, v, c(0.32), c(0.5), c(0.62), c(0.5)) <= r ||
    distToSegment(u, v, c(0.62), c(0.5), c(0.62), c(0.36)) <= r;
  const head = inTriangle(u, v, [c(0.62), c(0.2), c(0.48), c(0.38), c(0.76), c(0.38)]);
  return shaft || head;
}

function render(size, { maskable = false, transparent = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = maskable ? 0.76 : 1;
  const samples = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          if (glyphCoverage(u, v, inset)) hits++;
        }
      }
      const a = hits / (samples * samples);
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        rgba[i + ch] = transparent ? FG[ch] : Math.round(BG[ch] * (1 - a) + FG[ch] * a);
      }
      // iOS ignores alpha on apple-touch-icon and composites it on black, so
      // the opaque variants are fully opaque on purpose.
      rgba[i + 3] = transparent ? Math.round(a * 255) : 255;
    }
  }
  return png(size, size, rgba);
}

const files = [
  ['pwa-192x192.png', render(192)],
  ['pwa-512x512.png', render(512)],
  ['maskable-512x512.png', render(512, { maskable: true })],
  ['apple-touch-icon.png', render(180)],
  ['favicon-32x32.png', render(32)],
];

for (const [name, data] of files) {
  writeFileSync(join(out, name), data);
  console.log(`${name}  ${(data.length / 1024).toFixed(1)}kB`);
}
