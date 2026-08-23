/** Command-line parsing for the sweep CLI, isolated from process.argv and stdio so it is unit-testable. */

import { parseArgs } from 'node:util';
import type { CellParams } from './types.js';

export class HarnessArgError extends Error {}

export interface SingleModeArgs {
  readonly mode: 'single';
  readonly seeds: number;
  readonly seedBase: number;
  readonly overrides: Partial<CellParams>;
}

export interface SweepModeArgs {
  readonly mode: 'sweep';
  readonly specPath: string;
}

export type ModeArgs = SingleModeArgs | SweepModeArgs;

export interface CliArgs {
  readonly mode: ModeArgs;
  readonly json?: string;
  readonly csv?: string;
  readonly maxAttempts?: number;
  readonly help: boolean;
}

const OPTIONS = {
  seeds: { type: 'string' },
  grid: { type: 'string' },
  mean: { type: 'string' },
  variance: { type: 'string' },
  fill: { type: 'string' },
  'min-piece-length': { type: 'string' },
  'min-straight-run': { type: 'string' },
  'bend-probability': { type: 'string' },
  'seed-base': { type: 'string' },
  'max-attempts': { type: 'string' },
  sweep: { type: 'string' },
  json: { type: 'string' },
  csv: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

const DEFAULT_SEEDS = 20;
const DEFAULT_GRID = 40;
const DEFAULT_SEED_BASE = 1;

export const HELP_TEXT = `Usage:
  harness --seeds N --grid G [--mean M] [--variance V] [--fill F] [--json out.json] [--csv out.csv]
  harness --sweep sweep.json [--json out.json] [--csv out.csv]

Options:
  --seeds N              seeds per cell (default ${DEFAULT_SEEDS})
  --grid G                gridSize (default ${DEFAULT_GRID})
  --mean M                meanPieceLength
  --variance V             pieceLengthVariance
  --fill F                 fillFraction
  --min-piece-length N      minPieceLength
  --min-straight-run N      minStraightRun
  --bend-probability P      bendProbability
  --seed-base N             first seed of each cell (default ${DEFAULT_SEED_BASE})
  --sweep FILE              JSON parameter grid; replaces --grid/--mean/...
  --max-attempts N          generateBoardWithDiagnostics retry budget
  --json FILE               write rows + aggregates as JSON
  --csv FILE                write rows as CSV, aggregates as FILE with a .agg.csv suffix
  --help                   print this message`;

function parseNumber(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new HarnessArgError(`--${name} must be a number, got "${raw}"`);
  return value;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let values;
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: false }));
  } catch (err) {
    throw new HarnessArgError(err instanceof Error ? err.message : String(err));
  }

  const help = values.help ?? false;
  const outputs = optionalFields({
    json: values.json,
    csv: values.csv,
    maxAttempts: parseNumber('max-attempts', values['max-attempts']),
  });

  if (values.sweep !== undefined) {
    return { mode: { mode: 'sweep', specPath: values.sweep }, help, ...outputs };
  }

  const overrides: { -readonly [K in keyof CellParams]?: CellParams[K] } = {};
  const grid = parseNumber('grid', values.grid);
  const mean = parseNumber('mean', values.mean);
  const variance = parseNumber('variance', values.variance);
  const fill = parseNumber('fill', values.fill);
  const minPieceLength = parseNumber('min-piece-length', values['min-piece-length']);
  const minStraightRun = parseNumber('min-straight-run', values['min-straight-run']);
  const bendProbability = parseNumber('bend-probability', values['bend-probability']);
  if (grid !== undefined) overrides.gridSize = grid;
  if (mean !== undefined) overrides.meanPieceLength = mean;
  if (variance !== undefined) overrides.pieceLengthVariance = variance;
  if (fill !== undefined) overrides.fillFraction = fill;
  if (minPieceLength !== undefined) overrides.minPieceLength = minPieceLength;
  if (minStraightRun !== undefined) overrides.minStraightRun = minStraightRun;
  if (bendProbability !== undefined) overrides.bendProbability = bendProbability;

  const seeds = parseNumber('seeds', values.seeds) ?? DEFAULT_SEEDS;
  const seedBase = parseNumber('seed-base', values['seed-base']) ?? DEFAULT_SEED_BASE;
  if (!Number.isInteger(seeds) || seeds < 1)
    throw new HarnessArgError(`--seeds must be a positive integer, got ${seeds}`);

  return {
    mode: { mode: 'single', seeds, seedBase, overrides: { gridSize: DEFAULT_GRID, ...overrides } },
    help,
    ...outputs,
  };
}

type Defined<T> = T extends undefined ? never : T;

/** Drops keys whose value is `undefined`, so an optional property is either present with a value or absent — never present-and-undefined, which `exactOptionalPropertyTypes` treats as a distinct, disallowed state. */
function optionalFields<T extends Record<string, unknown>>(
  fields: T,
): { [K in keyof T]?: Defined<T[K]> } {
  const result: { [K in keyof T]?: Defined<T[K]> } = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const value = fields[key];
    if (value !== undefined) result[key] = value as Defined<T[keyof T]>;
  }
  return result;
}
