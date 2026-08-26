/**
 * The line-art spike: rasterise drawings, turn their faces into lobes, run the
 * real generator over the result, and report what survives at each size.
 *
 * Usage: npx tsx spikes/line-art/run.ts --art <dir> --solid <dir> --out <dir>
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { repairMask, type RepairOptions } from '../../src/core/mask/index.js';
import { DEFAULT_GEN_PARAMS, type GenParams, type Mask } from '../../src/core/types.js';
import { boardFromMask } from './board.js';
import { cutSolid, facesFromInk } from './faces.js';
import { asSolid, openRasteriser, withStrokeWidth, type Rasteriser } from './raster.js';
import { writeSheet, type Tile } from './sheet.js';

const SIZES = [40, 60, 78, 100];
const STROKE_CELLS = [2, 3, 4, 6];
const SHEET_STROKE = 4;

const REPAIR_PROFILES: Record<string, RepairOptions> = {
  default: {},
  authored: { holeAreaThreshold: 0 },
};

interface Row {
  readonly source: string;
  readonly route: string;
  readonly name: string;
  readonly size: number;
  readonly stroke: number;
  readonly profile: string;
  readonly inkCells: number;
  readonly facesPre: number;
  readonly facesPreLargest: number;
  readonly regions: number;
  readonly pathCells: number;
  readonly segments: number;
  readonly coverage: number;
  readonly bendRate: number;
  readonly dagDepth: number;
  readonly failure: string;
}

function arg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

function svgsIn(dir: string): { name: string; svg: string }[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => ({ name: basename(file, '.svg'), svg: readFileSync(join(dir, file), 'utf8') }));
}

function emptyRow(
  base: Omit<
    Row,
    'regions' | 'pathCells' | 'segments' | 'coverage' | 'bendRate' | 'dagDepth' | 'failure'
  >,
  failure: string,
): Row {
  return {
    ...base,
    regions: 0,
    pathCells: 0,
    segments: 0,
    coverage: 0,
    bendRate: 0,
    dagDepth: 0,
    failure,
  };
}

function measure(
  ink: Uint8Array,
  size: number,
  profile: string,
  base: Omit<
    Row,
    'regions' | 'pathCells' | 'segments' | 'coverage' | 'bendRate' | 'dagDepth' | 'failure'
  >,
): { row: Row; mask: Mask | null; colours: number[] | null } {
  const faces = facesFromInk(ink, size, size);
  const withFaces = {
    ...base,
    facesPre: faces.faceSizes.length,
    facesPreLargest: faces.faceSizes[0] ?? 0,
  };
  if (faces.faceSizes.length === 0) {
    return {
      row: emptyRow(withFaces, 'no enclosed face — the drawing leaked'),
      mask: null,
      colours: null,
    };
  }

  let mask: Mask;
  try {
    mask = repairMask(faces.blob, REPAIR_PROFILES[profile] ?? {});
  } catch (err) {
    return {
      row: emptyRow(withFaces, `repair: ${(err as Error).message}`),
      mask: null,
      colours: null,
    };
  }

  const params: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize: size, seed: 7 };
  const outcome = boardFromMask(mask, params);
  if (!outcome.ok) {
    return {
      row: {
        ...withFaces,
        regions: mask.regionCount,
        pathCells: mask.pathCellCount,
        segments: 0,
        coverage: 0,
        bendRate: 0,
        dagDepth: 0,
        failure: outcome.reason,
      },
      mask,
      colours: null,
    };
  }

  const { board, metrics } = outcome;
  const colours: number[] = new Array<number>(size * size).fill(-1);
  for (let i = 0; i < size * size; i++) {
    const segment = board.occupancy[i] as number;
    if (segment !== 0) colours[i] = board.segColor[segment - 1] as number;
  }
  return {
    row: {
      ...withFaces,
      regions: mask.regionCount,
      pathCells: mask.pathCellCount,
      segments: board.segmentCount,
      coverage: metrics.coverage,
      bendRate: metrics.bendRate,
      dagDepth: metrics.dagDepth,
      failure: '',
    },
    mask,
    colours,
  };
}

async function main(): Promise<void> {
  const artDir = arg('--art', 'art');
  const solidDir = arg('--solid', 'art-solid');
  const outDir = arg('--out', 'out');
  mkdirSync(outDir, { recursive: true });

  const raster: Rasteriser = await openRasteriser();
  const rows: Row[] = [];
  const tiles: Tile[] = [];

  for (const { name, svg } of svgsIn(artDir)) {
    for (const size of SIZES) {
      for (const stroke of STROKE_CELLS) {
        const ink = await raster.ink(withStrokeWidth(svg, stroke, size), size);
        for (const profile of Object.keys(REPAIR_PROFILES)) {
          const base = {
            source: 'lucide',
            route: 'line-art',
            name,
            size,
            stroke,
            profile,
            inkCells: countInk(ink),
            facesPre: 0,
            facesPreLargest: 0,
          };
          const result = measure(ink, size, profile, base);
          rows.push(result.row);
          if (profile === 'authored' && stroke === SHEET_STROKE && result.colours !== null) {
            tiles.push({
              label: `${name} ${size}`,
              width: size,
              height: size,
              cells: result.colours,
            });
          }
        }
      }
    }
    process.stdout.write(`line-art ${name}\n`);
  }

  for (const { name, svg } of svgsIn(solidDir)) {
    for (const size of SIZES) {
      const solid = await raster.ink(asSolid(svg), size);
      for (const stroke of STROKE_CELLS) {
        const spacing = Math.max(stroke + 2, Math.round(size / 8));
        const ink = cutSolid(solid, size, size, spacing, stroke, Math.PI / 5);
        for (const profile of Object.keys(REPAIR_PROFILES)) {
          const base = {
            source: 'mdi-solid',
            route: `cut-${spacing}`,
            name,
            size,
            stroke,
            profile,
            inkCells: countInk(ink),
            facesPre: 0,
            facesPreLargest: 0,
          };
          const result = measure(ink, size, profile, base);
          rows.push(result.row);
          if (profile === 'authored' && stroke === SHEET_STROKE && result.colours !== null) {
            tiles.push({
              label: `cut ${name} ${size}`,
              width: size,
              height: size,
              cells: result.colours,
            });
          }
        }
      }
    }
    process.stdout.write(`cut ${name}\n`);
  }

  writeFileSync(join(outDir, 'results.csv'), toCsv(rows));
  await raster.close();
  await writeSheet(tiles, join(outDir, 'contact-sheet.png'));
  process.stdout.write(`${rows.length} rows -> ${join(outDir, 'results.csv')}\n`);
}

function countInk(ink: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i] === 1) n++;
  return n;
}

function toCsv(rows: readonly Row[]): string {
  const header = Object.keys(rows[0] ?? {}).join(',');
  const body = rows.map((row) =>
    Object.values(row)
      .map((value) => (typeof value === 'number' ? String(value) : `"${String(value)}"`))
      .join(','),
  );
  return [header, ...body].join('\n');
}

await main();
