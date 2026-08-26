/**
 * The automated half of curation. Every candidate is baked, imported and put
 * through the real generator; anything that leaks, fails, or comes out as a
 * doodle in a mostly empty frame is rejected with its reason. What survives
 * goes to a contact sheet for a person to prune.
 *
 * Usage: npx tsx tools/shapes/approve.ts --art <dir> --out <dir>
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { generateBoardWithDiagnostics } from '../../src/core/generate.js';
import { importShape } from '../../src/core/shape/index.js';
import { DEFAULT_GEN_PARAMS } from '../../src/core/types.js';
import { fitInk } from './fit.js';
import { openRasteriser, withStrokeWidth, withoutIntrinsicSize } from './raster.js';
import { writeSheet, type Tile } from './sheet.js';

/** The bake resolution the runtime resamples from. */
export const BAKE_EDGE = 96;
const RASTER_EDGE = 256;
const BAKE_STROKE_UNITS = 0.25;
/** The size the automated pass judges at: the shipped default. */
const JUDGE_GRID = 78;
/** Below this share of the frame the drawing is a doodle in an empty board. */
const MIN_FILL = 0.18;

export interface Verdict {
  readonly id: string;
  readonly name: string;
  readonly regions: number;
  readonly fill: number;
  readonly segments: number;
  readonly rejected: string | null;
}

/** `moped-front` reads as a filename. A player is shown "Moped front". */
export function displayName(id: string): string {
  const words = id.split('-');
  const first = words[0] ?? id;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

async function main(): Promise<void> {
  const artDir = arg('--art', 'art');
  const outDir = arg('--out', 'out');
  mkdirSync(outDir, { recursive: true });
  const raster = await openRasteriser();

  const verdicts: Verdict[] = [];
  const tiles: Tile[] = [];
  const bakes = new Map<string, Uint8Array>();

  for (const file of readdirSync(artDir).filter((f) => f.endsWith('.svg'))) {
    const id = basename(file, '.svg');
    const svg = withoutIntrinsicSize(readFileSync(join(artDir, file), 'utf8'));
    const drawn = await raster.ink(withStrokeWidth(svg, BAKE_STROKE_UNITS, 24), RASTER_EDGE);
    const baked = fitInk(drawn, RASTER_EDGE, 0, BAKE_EDGE, BAKE_EDGE);
    bakes.set(id, baked);

    const base = { id, name: displayName(id) };
    const imported = importShape({
      ink: baked,
      sourceWidth: BAKE_EDGE,
      sourceHeight: BAKE_EDGE,
      gridSize: JUDGE_GRID,
    });
    if (!imported.ok) {
      verdicts.push({ ...base, regions: 0, fill: 0, segments: 0, rejected: imported.reason });
      continue;
    }

    try {
      const { board, mask } = generateBoardWithDiagnostics(
        { ...DEFAULT_GEN_PARAMS, gridSize: JUDGE_GRID, seed: 5 },
        { silhouette: imported.blob, repair: { holeAreaThreshold: 0 } },
      );
      const fill = mask.pathCellCount / (JUDGE_GRID * JUDGE_GRID);
      const collapsed = imported.faceCount > 1 && mask.regionCount === 1;
      const rejected = collapsed ? 'faces collapsed' : fill < MIN_FILL ? 'too thin' : null;
      verdicts.push({
        ...base,
        regions: mask.regionCount,
        fill,
        segments: board.segmentCount,
        rejected,
      });
      if (rejected === null) {
        const cells: number[] = new Array<number>(JUDGE_GRID * JUDGE_GRID).fill(-1);
        for (let i = 0; i < cells.length; i++) {
          const segment = board.occupancy[i] as number;
          if (segment !== 0) cells[i] = board.segColor[segment - 1] as number;
        }
        tiles.push({ label: base.name, width: JUDGE_GRID, height: JUDGE_GRID, cells });
      }
    } catch (err) {
      verdicts.push({
        ...base,
        regions: 0,
        fill: 0,
        segments: 0,
        rejected: `generate: ${(err as Error).message.slice(0, 60)}`,
      });
    }
  }

  await raster.close();

  const approved = verdicts.filter((v) => v.rejected === null);
  writeFileSync(
    join(outDir, 'approved.json'),
    `${JSON.stringify(
      approved.map((v) => ({ id: v.id, name: v.name })),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(outDir, 'rejected.csv'),
    ['id,reason,regions,fill,segments']
      .concat(
        verdicts
          .filter((v) => v.rejected !== null)
          .map(
            (v) => `${v.id},"${v.rejected ?? ''}",${v.regions},${v.fill.toFixed(3)},${v.segments}`,
          ),
      )
      .join('\n') + '\n',
  );

  const perSheet = 60;
  for (let start = 0; start < tiles.length; start += perSheet) {
    await writeSheet(
      tiles.slice(start, start + perSheet),
      join(outDir, `sheet-${String(start / perSheet + 1).padStart(2, '0')}.png`),
      10,
    );
  }
  process.stdout.write(
    `${approved.length} approved of ${verdicts.length}; ${verdicts.length - approved.length} rejected\n`,
  );
}

await main();
