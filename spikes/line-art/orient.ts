/**
 * Orientation and frame shape. A board is square today, a phone is not, and an
 * elongated drawing wastes most of a square frame — so this rotates the baked
 * ink, fits it to a portrait frame, and measures how much board that buys.
 *
 * Rotation happens on the bake, not on the source, so it stays a build-time
 * transform with no second rasterisation.
 *
 * Usage: npx tsx spikes/line-art/orient.ts --art <dir> --out <dir>
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { repairMask } from '../../src/core/mask/index.js';
import { DEFAULT_GEN_PARAMS, type GenParams } from '../../src/core/types.js';
import { boardFromMask } from './board.js';
import { facesFromInk } from './faces.js';
import { openRasteriser, withStrokeWidth } from './raster.js';
import { writeSheet, type Tile } from './sheet.js';

const BAKE_EDGE = 256;
/** Thin at bake time: final stroke width is set by dilation, not by scale. */
const BAKE_STROKE_UNITS = 0.25;
const DILATIONS = [1, 2];
const ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];
const FRAMES = [
  { label: 'square-78', width: 78, height: 78 },
  { label: 'square-60', width: 60, height: 60 },
  { label: 'portrait-72x120', width: 72, height: 120 },
  { label: 'portrait-60x100', width: 60, height: 100 },
  { label: 'portrait-52x92', width: 52, height: 92 },
];

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function inkBounds(ink: Uint8Array, edge: number): Bounds {
  let minX = edge;
  let minY = edge;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      if (ink[y * edge + x] !== 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Inverse-mapped so every target cell is filled: rotate the target cell back
 * into the bake and take any ink in its preimage, which keeps a hairline
 * stroke from dropping out between samples.
 */
function fitInk(
  ink: Uint8Array,
  edge: number,
  angle: number,
  width: number,
  height: number,
): Uint8Array {
  const bounds = inkBounds(ink, edge);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  let spanX = 0;
  let spanY = 0;
  for (const [px, py] of [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.maxY],
  ] as const) {
    const rx = Math.abs((px - cx) * cos - (py - cy) * sin);
    const ry = Math.abs((px - cx) * sin + (py - cy) * cos);
    if (rx > spanX) spanX = rx;
    if (ry > spanY) spanY = ry;
  }

  const scale = Math.min((width - 2) / (2 * spanX), (height - 2) / (2 * spanY));
  const out = new Uint8Array(width * height);
  const samples = [0.25, 0.5, 0.75];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (const sy of samples) {
        for (const sx of samples) {
          const tx = (x + sx - width / 2) / scale;
          const ty = (y + sy - height / 2) / scale;
          const ux = tx * cos + ty * sin + cx;
          const uy = -tx * sin + ty * cos + cy;
          const px = Math.round(ux);
          const py = Math.round(uy);
          if (px < 0 || py < 0 || px >= edge || py >= edge) continue;
          if (ink[py * edge + px] === 1) {
            hit = 1;
            break;
          }
        }
        if (hit === 1) break;
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/** Chebyshev dilation: the stroke width the player sees, set after fitting. */
function dilateInk(ink: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = ink;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let hit = 0;
        for (let dy = -1; dy <= 1 && hit === 0; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (current[ny * width + nx] === 1) {
              hit = 1;
              break;
            }
          }
        }
        next[y * width + x] = hit;
      }
    }
    current = next;
  }
  return current;
}

interface Row {
  readonly name: string;
  readonly frame: string;
  readonly angle: number;
  readonly dilation: number;
  readonly regions: number;
  readonly pathCells: number;
  readonly fill: number;
  readonly segments: number;
  readonly failure: string;
}

async function main(): Promise<void> {
  const artDir = arg('--art', 'art');
  const outDir = arg('--out', 'out');
  mkdirSync(outDir, { recursive: true });
  const raster = await openRasteriser();
  const rows: Row[] = [];
  const sheetFrame = arg('--sheet-frame', 'portrait-72x120');
  const bestTile = new Map<string, { fill: number; tile: Tile }>();

  for (const file of readdirSync(artDir).filter((f) => f.endsWith('.svg'))) {
    const name = basename(file, '.svg');
    const svg = readFileSync(join(artDir, file), 'utf8');
    const baked = await raster.ink(withStrokeWidth(svg, BAKE_STROKE_UNITS, 24), BAKE_EDGE);

    for (const frame of FRAMES) {
      for (const angle of ANGLES) {
        const fitted = fitInk(baked, BAKE_EDGE, angle, frame.width, frame.height);
        for (const dilation of DILATIONS) {
          const ink = dilateInk(fitted, frame.width, frame.height, dilation);
          const faces = facesFromInk(ink, frame.width, frame.height);
          const base = { name, frame: frame.label, angle, dilation };
          if (faces.faceSizes.length === 0) {
            rows.push({
              ...base,
              regions: 0,
              pathCells: 0,
              fill: 0,
              segments: 0,
              failure: 'leaked',
            });
            continue;
          }
          try {
            const mask = repairMask(faces.blob, { holeAreaThreshold: 0 });
            const params: GenParams = {
              ...DEFAULT_GEN_PARAMS,
              gridSize: Math.max(frame.width, frame.height),
              seed: 7,
            };
            const outcome = boardFromMask(mask, params);
            if (outcome.ok && dilation === 1 && frame.label === sheetFrame) {
              const fill = mask.pathCellCount / (frame.width * frame.height);
              const previous = bestTile.get(name);
              if (previous === undefined || fill > previous.fill) {
                const cells: number[] = new Array<number>(frame.width * frame.height).fill(-1);
                for (let i = 0; i < cells.length; i++) {
                  const segment = outcome.board.occupancy[i] as number;
                  if (segment !== 0) cells[i] = outcome.board.segColor[segment - 1] as number;
                }
                bestTile.set(name, {
                  fill,
                  tile: {
                    label: `${name} ${angle}`,
                    width: frame.width,
                    height: frame.height,
                    cells,
                  },
                });
              }
            }
            rows.push({
              ...base,
              regions: mask.regionCount,
              pathCells: mask.pathCellCount,
              fill: mask.pathCellCount / (frame.width * frame.height),
              segments: outcome.ok ? outcome.board.segmentCount : 0,
              failure: outcome.ok ? '' : outcome.reason,
            });
          } catch (err) {
            rows.push({
              ...base,
              regions: 0,
              pathCells: 0,
              fill: 0,
              segments: 0,
              failure: `repair: ${(err as Error).message.slice(0, 60)}`,
            });
          }
        }
      }
    }
    process.stdout.write(`${name}\n`);
  }

  await raster.close();
  await writeSheet(
    [...bestTile.values()].map((entry) => entry.tile),
    join(outDir, 'orientation-sheet.png'),
    9,
  );
  const header = 'name,frame,angle,dilation,regions,pathCells,fill,segments,failure';
  const body = rows.map(
    (r) =>
      `${r.name},${r.frame},${r.angle},${r.dilation},${r.regions},${r.pathCells},${r.fill.toFixed(4)},${r.segments},"${r.failure}"`,
  );
  writeFileSync(join(outDir, 'orientation.csv'), [header, ...body].join('\n'));
  process.stdout.write(`${rows.length} rows -> ${join(outDir, 'orientation.csv')}\n`);
}

await main();
