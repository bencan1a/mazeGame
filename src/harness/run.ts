/** Runs each seed of each `ParamCell` through the generator and reports one row per board. */

import { generateBoardWithDiagnostics, GenerationFailedError } from '../core/generate.js';
import type { GenerateBoardOptions } from '../core/generate.js';
import { computeMetrics } from '../core/metrics.js';
import type { GenParams } from '../core/types.js';
import type { BoardRow, ParamCell } from './types.js';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface RunOptions {
  readonly clock?: Clock;
  readonly maxAttempts?: number;
}

export function runCell(cell: ParamCell, options: RunOptions = {}): BoardRow[] {
  return cell.seeds.map((seed) => runOne(cell.cellIndex, { ...cell.params, seed }, options));
}

export function runCells(cells: readonly ParamCell[], options: RunOptions = {}): BoardRow[] {
  return cells.flatMap((cell) => runCell(cell, options));
}

function runOne(cellIndex: number, params: GenParams, options: RunOptions): BoardRow {
  const clock = options.clock ?? systemClock;
  const generateOptions: GenerateBoardOptions =
    options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts };
  const start = clock.now();
  try {
    const { board, diagnostics } = generateBoardWithDiagnostics(params, generateOptions);
    const generationMs = clock.now() - start;
    return {
      cellIndex,
      seed: params.seed,
      params,
      ok: true,
      attempts: diagnostics.attempts,
      metrics: { ...computeMetrics(board), generationMs },
      peel: diagnostics.peel,
    };
  } catch (err) {
    const message =
      err instanceof GenerationFailedError || err instanceof Error ? err.message : String(err);
    return { cellIndex, seed: params.seed, params, ok: false, error: message };
  }
}
