import { describe, expect, it } from 'vitest';
import type { ParamCell } from './types.js';
import { runCell, runCells } from './run.js';
import type { Clock } from './run.js';

function fakeClock(ticks: readonly number[]): Clock {
  let i = 0;
  return { now: () => ticks[Math.min(i++, ticks.length - 1)] as number };
}

const smallCell: ParamCell = {
  cellIndex: 0,
  params: {
    gridSize: 20,
    meanPieceLength: 6,
    pieceLengthVariance: 8,
    minPieceLength: 2,
    bendProbability: 0.35,
    minStraightRun: 2,
    fillFraction: 0.45,
    lobeCount: 1,
  },
  seeds: [1, 2],
};

describe('runCell', () => {
  it('produces one row per seed, in seed order', () => {
    const rows = runCell(smallCell);
    expect(rows.map((r) => r.seed)).toEqual([1, 2]);
  });

  it('reads generationMs from the injected clock rather than the wall clock', () => {
    const rows = runCell(smallCell, { clock: fakeClock([100, 137, 100, 111]) });
    expect(rows[0]?.ok).toBe(true);
    if (rows[0]?.ok) expect(rows[0].metrics.generationMs).toBe(37);
  });

  it('is deterministic: the same cell run twice yields identical metrics per seed', () => {
    const first = runCell(smallCell);
    const second = runCell(smallCell);
    expect(first.map(stripTiming)).toEqual(second.map(stripTiming));
  });
});

function stripTiming(row: ReturnType<typeof runCell>[number]) {
  if (!row.ok) return row;
  return { ...row, metrics: { ...row.metrics, generationMs: 0 } };
}

describe('runCells', () => {
  it('flattens rows across every cell, preserving cellIndex', () => {
    const other: ParamCell = { ...smallCell, cellIndex: 1, seeds: [3] };
    const rows = runCells([smallCell, other]);
    expect(rows.map((r) => r.cellIndex)).toEqual([0, 0, 1]);
  });

  it('threads a maxAttempts override into generation without throwing on a normal board', () => {
    const rows = runCells([smallCell], { maxAttempts: 8 });
    expect(rows.every((r) => r.ok)).toBe(true);
  });
});
