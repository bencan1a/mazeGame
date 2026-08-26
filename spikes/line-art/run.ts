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

interface Tile {
  readonly label: string;
  readonly size: number;
  readonly cells: number[];
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
            tiles.push({ label: `${name} ${size}`, size, cells: result.colours });
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
            tiles.push({ label: `cut ${name} ${size}`, size, cells: result.colours });
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

async function writeSheet(tiles: readonly Tile[], file: string): Promise<void> {
  if (tiles.length === 0) return;
  const raster = await openRasteriser();
  await raster.close();
  const { chromium } = await import('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
  const page = await browser.newPage({ viewport: { width: 1240, height: 800 } });
  await page.setContent(sheetHtml(tiles));
  await page.locator('#sheet').screenshot({ path: file });
  await browser.close();
}

const PALETTE = [
  '#f4b400',
  '#3ea6ff',
  '#8bd0ff',
  '#12b886',
  '#ff7043',
  '#b388ff',
  '#f06292',
  '#9ccc65',
];

function sheetHtml(tiles: readonly Tile[]): string {
  const cells = tiles
    .map(
      (tile) =>
        `<figure><canvas width="${tile.size}" height="${tile.size}" data-cells='${JSON.stringify(tile.cells)}'></canvas><figcaption>${tile.label}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12101f;font:11px system-ui,sans-serif;color:#c9c6d8}
    #sheet{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:12px;width:1216px}
    figure{margin:0;text-align:center}
    canvas{width:100%;image-rendering:pixelated;background:#171429;border-radius:4px}
    figcaption{padding-top:3px}
  </style><div id="sheet">${cells}</div><script>
    const palette = ${JSON.stringify(PALETTE)};
    for (const canvas of document.querySelectorAll('canvas')) {
      const cells = JSON.parse(canvas.dataset.cells);
      const ctx = canvas.getContext('2d');
      const edge = canvas.width;
      const image = ctx.createImageData(edge, edge);
      for (let i = 0; i < cells.length; i++) {
        const colour = cells[i] < 0 ? null : palette[cells[i] % palette.length];
        const rgb = colour === null ? [23, 20, 41] : [parseInt(colour.slice(1,3),16), parseInt(colour.slice(3,5),16), parseInt(colour.slice(5,7),16)];
        image.data[i*4] = rgb[0]; image.data[i*4+1] = rgb[1]; image.data[i*4+2] = rgb[2]; image.data[i*4+3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }
  </script>`;
}

await main();
