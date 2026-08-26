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
import { dilateInk, fitInk } from './fit.js';
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
