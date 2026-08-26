/**
 * One sheet per source set, so the four candidates can be compared as boards
 * rather than as icon counts. Each set needs a different treatment to get to
 * ink: strokes, a drawn fill, boundaries between flat colours, or cuts across
 * a solid.
 *
 * Usage: npx tsx spikes/line-art/sets.ts --art <dir> --mode stroke|fill|colour|solid --out <file>
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { repairMask } from '../../src/core/mask/index.js';
import { DEFAULT_GEN_PARAMS, type GenParams } from '../../src/core/types.js';
import { boardFromMask } from './board.js';
import { cutSolid, facesFromInk } from './faces.js';
import { dilateInk, fitInk } from './fit.js';
import { openRasteriser, withStrokeWidth, withoutIntrinsicSize } from './raster.js';
import { writeSheet, type Tile } from './sheet.js';

const BAKE_EDGE = 256;
const BAKE_STROKE_UNITS = 0.25;
const EDGE = 78;
const DILATION = 1;

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

async function main(): Promise<void> {
  const artDir = arg('--art', 'art');
  const mode = arg('--mode', 'stroke');
  const out = arg('--out', 'sheet.png');
  const raster = await openRasteriser();
  const tiles: Tile[] = [];
  let built = 0;
  let total = 0;

  for (const file of readdirSync(artDir).filter((f) => f.endsWith('.svg'))) {
    total++;
    const name = basename(file, '.svg');
    const svg = withoutIntrinsicSize(readFileSync(join(artDir, file), 'utf8'));

    let ink: Uint8Array;
    if (mode === 'colour') {
      ink = dilateInk(
        fitInk(await raster.boundaryInk(svg, BAKE_EDGE), BAKE_EDGE, 0, EDGE, EDGE),
        EDGE,
        EDGE,
        DILATION,
      );
    } else if (mode === 'solid') {
      const solid = fitInk(await raster.ink(svg, BAKE_EDGE), BAKE_EDGE, 0, EDGE, EDGE);
      ink = cutSolid(solid, EDGE, EDGE, Math.round(EDGE / 8), 3, Math.PI / 5);
    } else {
      const baked =
        mode === 'stroke'
          ? await raster.ink(withStrokeWidth(svg, BAKE_STROKE_UNITS, 24), BAKE_EDGE)
          : await raster.ink(svg, BAKE_EDGE);
      ink = dilateInk(fitInk(baked, BAKE_EDGE, 0, EDGE, EDGE), EDGE, EDGE, DILATION);
    }

    const faces = facesFromInk(ink, EDGE, EDGE);
    if (faces.faceSizes.length === 0) continue;
    try {
      const mask = repairMask(faces.blob, { holeAreaThreshold: 0 });
      const params: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize: EDGE, seed: 7 };
      const outcome = boardFromMask(mask, params);
      if (!outcome.ok) continue;
      if (mask.pathCellCount / (EDGE * EDGE) < 0.12) continue;
      built++;
      const cells: number[] = new Array<number>(EDGE * EDGE).fill(-1);
      for (let i = 0; i < cells.length; i++) {
        const segment = outcome.board.occupancy[i] as number;
        if (segment !== 0) cells[i] = outcome.board.segColor[segment - 1] as number;
      }
      tiles.push({
        label: `${name} · ${mask.regionCount}`,
        width: EDGE,
        height: EDGE,
        cells,
      });
    } catch {
      continue;
    }
  }

  await raster.close();
  await writeSheet(tiles, out, 8);
  process.stdout.write(`${mode}: ${built}/${total} usable -> ${out}\n`);
}

await main();
