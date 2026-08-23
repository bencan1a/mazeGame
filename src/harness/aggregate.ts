/** Collapses one cell's per-board rows into a `CellAggregate`. */

import type { BoardRow, BoardRowOk, CellAggregate, ParamCell, Stat } from './types.js';

function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { mean: 0, min: 0, max: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { mean: sum / values.length, min, max };
}

function pluck<K extends keyof BoardRowOk['metrics']>(
  rows: readonly BoardRowOk[],
  key: K,
): number[] {
  return rows.map((r) => r.metrics[key]);
}

function pluckPeel<K extends keyof BoardRowOk['peel']>(
  rows: readonly BoardRowOk[],
  key: K,
): number[] {
  return rows.map((r) => r.peel[key]);
}

export function aggregateCell(cell: ParamCell, rows: readonly BoardRow[]): CellAggregate {
  const ok = rows.filter((r): r is BoardRowOk => r.ok);
  const failed = rows.filter((r): r is Extract<BoardRow, { ok: false }> => !r.ok);

  return {
    cellIndex: cell.cellIndex,
    params: cell.params,
    seedCount: cell.seeds.length,
    failureCount: failed.length,
    failedSeeds: failed.map((f) => f.seed),
    generationMs: stat(pluck(ok, 'generationMs')),
    attempts: stat(ok.map((r) => r.attempts)),
    segmentCount: stat(pluck(ok, 'segmentCount')),
    coverage: stat(pluck(ok, 'coverage')),
    meanSegmentLength: stat(pluck(ok, 'meanSegmentLength')),
    bendRate: stat(pluck(ok, 'bendRate')),
    dagDepth: stat(pluck(ok, 'dagDepth')),
    meanFreeSetSize: stat(pluck(ok, 'meanFreeSetSize')),
    minFreeSetSize: stat(pluck(ok, 'minFreeSetSize')),
    edgeCount: stat(pluck(ok, 'edgeCount')),
    shortOfTarget: stat(pluckPeel(ok, 'shortOfTarget')),
    belowMinimum: stat(pluckPeel(ok, 'belowMinimum')),
    wholeRunEscapes: stat(pluckPeel(ok, 'wholeRunEscapes')),
    shortStraightRuns: stat(pluckPeel(ok, 'shortStraightRuns')),
  };
}

export function aggregateCells(
  cells: readonly ParamCell[],
  rows: readonly BoardRow[],
): CellAggregate[] {
  return cells.map((cell) =>
    aggregateCell(
      cell,
      rows.filter((r) => r.cellIndex === cell.cellIndex),
    ),
  );
}
