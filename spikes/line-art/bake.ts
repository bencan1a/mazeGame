/**
 * Two questions the sweep does not answer: whether one canonical bake can be
 * resampled per board size, and what a baked library costs in the bundle.
 *
 * Usage: npx tsx spikes/line-art/bake.ts --art <dir>
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { repairMask } from '../../src/core/mask/index.js';
import { facesFromInk } from './faces.js';
import { openRasteriser, withStrokeWidth } from './raster.js';

const SIZES = [40, 60, 78, 100];
const STROKE_CELLS = 4;

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

/** Any covered source cell inks the target cell, matching how repair downsamples. */
function resampleInk(ink: Uint8Array, from: number, to: number): Uint8Array {
  const out = new Uint8Array(to * to);
  const scale = from / to;
  for (let y = 0; y < to; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < to; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      let hit = 0;
      for (let sy = y0; sy < y1 && hit === 0; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          if (ink[sy * from + sx] === 1) {
            hit = 1;
            break;
          }
        }
      }
      out[y * to + x] = hit;
    }
  }
  return out;
}

function pack(bits: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 1) out[i >> 3] = (out[i >> 3] as number) | (1 << (i & 7));
  }
  return out;
}

function regionsOf(ink: Uint8Array, size: number): number {
  const faces = facesFromInk(ink, size, size);
  if (faces.faceSizes.length === 0) return 0;
  try {
    return repairMask(faces.blob, { holeAreaThreshold: 0 }).regionCount;
  } catch {
    return 0;
  }
}

const BAKE_EDGE = Number(arg('--bake', '128'));
const raster = await openRasteriser();
const files = readdirSync(arg('--art', 'art')).filter((f) => f.endsWith('.svg'));
const packed: Uint8Array[] = [];
let agree = 0;
let total = 0;
process.stdout.write('icon        size  direct  from-bake\n');
for (const file of files) {
  const svg = readFileSync(join(arg('--art', 'art'), file), 'utf8');
  const name = basename(file, '.svg');
  const baked = await raster.ink(
    withStrokeWidth(svg, (STROKE_CELLS * BAKE_EDGE) / 78, BAKE_EDGE),
    BAKE_EDGE,
  );
  packed.push(pack(baked));
  for (const size of SIZES) {
    const direct = await raster.ink(withStrokeWidth(svg, STROKE_CELLS, size), size);
    const a = regionsOf(direct, size);
    const b = regionsOf(resampleInk(baked, BAKE_EDGE, size), size);
    total++;
    if (a === b) agree++;
    if (a !== b)
      process.stdout.write(
        `${name.padEnd(11)} ${String(size).padStart(4)}  ${String(a).padStart(6)}  ${String(b).padStart(9)}\n`,
      );
  }
}
await raster.close();

process.stdout.write(
  `bake ${BAKE_EDGE}: region count agrees with a direct raster on ${agree}/${total} shape-sizes\n`,
);
const blob = Buffer.concat(packed.map((p) => Buffer.from(p)));
const gz = gzipSync(blob, { level: 9 });
process.stdout.write(
  `\n${packed.length} shapes baked at ${BAKE_EDGE}x${BAKE_EDGE}: ${blob.length} B raw, ${gz.length} B gzipped ` +
    `(${(gz.length / packed.length).toFixed(0)} B/shape)\n`,
);
