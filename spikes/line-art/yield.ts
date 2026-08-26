/**
 * How big can the library actually get? Runs a stride sample of a whole icon
 * set through the importer at one configuration and reports how many produce a
 * board worth looking at — the number that decides whether "hundreds of shapes"
 * is a sourcing problem or a curation one.
 *
 * Usage: npx tsx spikes/line-art/yield.ts --art <dir> --out <dir> [--frame 78]
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { repairMask } from '../../src/core/mask/index.js';
import { DEFAULT_GEN_PARAMS, type GenParams } from '../../src/core/types.js';
import { boardFromMask } from './board.js';
import { facesFromInk } from './faces.js';
import { dilateInk, fitInk } from './fit.js';
import { openRasteriser, withStrokeWidth } from './raster.js';
import { writeSheet, type Tile } from './sheet.js';

const BAKE_EDGE = 256;
const BAKE_STROKE_UNITS = 0.25;
const DILATION = 1;
/** Below this share of the frame the drawing is a doodle in a large empty board. */
const MIN_FILL = 0.15;

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

async function main(): Promise<void> {
  const artDir = arg('--art', 'art');
  const outDir = arg('--out', 'out');
  const edge = Number(arg('--frame', '78'));
  mkdirSync(outDir, { recursive: true });

  const raster = await openRasteriser();
  const rows: string[] = ['name,faces,regions,pathCells,fill,segments,verdict'];
  const tiles: Tile[] = [];
  const counts = { total: 0, failed: 0, thin: 0, single: 0, multi: 0 };

  for (const file of readdirSync(artDir).filter((f) => f.endsWith('.svg'))) {
    const name = basename(file, '.svg');
    counts.total++;
    const svg = readFileSync(join(artDir, file), 'utf8');
    const baked = await raster.ink(withStrokeWidth(svg, BAKE_STROKE_UNITS, 24), BAKE_EDGE);
    const ink = dilateInk(fitInk(baked, BAKE_EDGE, 0, edge, edge), edge, edge, DILATION);
    const faces = facesFromInk(ink, edge, edge);

    let verdict = 'failed';
    let regions = 0;
    let pathCells = 0;
    let segments = 0;
    let fill = 0;
    if (faces.faceSizes.length > 0) {
      try {
        const mask = repairMask(faces.blob, { holeAreaThreshold: 0 });
        const params: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize: edge, seed: 7 };
        const outcome = boardFromMask(mask, params);
        regions = mask.regionCount;
        pathCells = mask.pathCellCount;
        fill = pathCells / (edge * edge);
        if (outcome.ok) {
          segments = outcome.board.segmentCount;
          verdict = fill < MIN_FILL ? 'thin' : regions === 1 ? 'single-face' : 'multi-face';
          if (verdict !== 'thin' && tiles.length < 54) {
            const cells: number[] = new Array<number>(edge * edge).fill(-1);
            for (let i = 0; i < cells.length; i++) {
              const segment = outcome.board.occupancy[i] as number;
              if (segment !== 0) cells[i] = outcome.board.segColor[segment - 1] as number;
            }
            tiles.push({ label: name, width: edge, height: edge, cells });
          }
        }
      } catch {
        verdict = 'failed';
      }
    }
    if (verdict === 'failed') counts.failed++;
    else if (verdict === 'thin') counts.thin++;
    else if (verdict === 'single-face') counts.single++;
    else counts.multi++;
    rows.push(
      `${name},${faces.faceSizes.length},${regions},${pathCells},${fill.toFixed(4)},${segments},${verdict}`,
    );
  }

  await raster.close();
  writeFileSync(join(outDir, 'yield.csv'), rows.join('\n'));
  await writeSheet(tiles, join(outDir, 'yield-sheet.png'), 9);
  const usable = counts.single + counts.multi;
  process.stdout.write(
    `${counts.total} icons: ${usable} usable (${((100 * usable) / counts.total).toFixed(0)}%) — ` +
      `${counts.multi} multi-face, ${counts.single} single-face, ${counts.thin} too thin, ${counts.failed} failed\n`,
  );
}

await main();
