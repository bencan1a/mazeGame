import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import type { GenParams, BoardMetrics } from '../core/types.js';
import type { PeelStats } from '../core/segment/index.js';
import { aggregateCell } from './aggregate.js';
import { defaultCellParams } from './paramGrid.js';
import type { BoardRow, BoardRowOk, ParamCell } from './types.js';

function metrics(overrides: Partial<BoardMetrics>): BoardMetrics {
  return {
    segmentCount: 10,
    coverage: 1,
    meanSegmentLength: 4,
    bendRate: 0.3,
    dagDepth: 5,
    meanFreeSetSize: 3,
    minFreeSetSize: 2,
    edgeCount: 12,
    generationMs: 10,
    ...overrides,
  };
}

function peel(overrides: Partial<PeelStats>): PeelStats {
  return {
    segmentCount: 10,
    meanLength: 4,
    lengthStdDev: 1,
    shortOfTarget: 0,
    belowMinimum: 0,
    wholeRunEscapes: 0,
    shortStraightRuns: 0,
    ...overrides,
  };
}

function okRow(seed: number, m: Partial<BoardMetrics>, p: Partial<PeelStats> = {}): BoardRowOk {
  const params: GenParams = { ...DEFAULT_GEN_PARAMS, seed };
  return { cellIndex: 0, seed, params, ok: true, attempts: 1, metrics: metrics(m), peel: peel(p) };
}

const cell: ParamCell = { cellIndex: 0, params: defaultCellParams(), seeds: [1, 2, 3] };

describe('aggregateCell', () => {
  it('reports mean, min and max over every ok row', () => {
    const rows: BoardRow[] = [
      okRow(1, { dagDepth: 2 }),
      okRow(2, { dagDepth: 6 }),
      okRow(3, { dagDepth: 4 }),
    ];
    const agg = aggregateCell(cell, rows);
    expect(agg.dagDepth).toEqual({ mean: 4, min: 2, max: 6 });
    expect(agg.seedCount).toBe(3);
    expect(agg.failureCount).toBe(0);
    expect(agg.failedSeeds).toEqual([]);
  });

  it('excludes failed rows from the metric stats and lists their seeds', () => {
    const rows: BoardRow[] = [
      okRow(1, { dagDepth: 5 }),
      {
        cellIndex: 0,
        seed: 2,
        params: { ...DEFAULT_GEN_PARAMS, seed: 2 },
        ok: false,
        error: 'boom',
      },
    ];
    const agg = aggregateCell({ ...cell, seeds: [1, 2] }, rows);
    expect(agg.dagDepth).toEqual({ mean: 5, min: 5, max: 5 });
    expect(agg.failureCount).toBe(1);
    expect(agg.failedSeeds).toEqual([2]);
  });

  it('returns zeroed stats for a cell with no ok rows', () => {
    const rows: BoardRow[] = [
      {
        cellIndex: 0,
        seed: 1,
        params: { ...DEFAULT_GEN_PARAMS, seed: 1 },
        ok: false,
        error: 'boom',
      },
    ];
    const agg = aggregateCell({ ...cell, seeds: [1] }, rows);
    expect(agg.dagDepth).toEqual({ mean: 0, min: 0, max: 0 });
    expect(agg.failureCount).toBe(1);
  });

  it('carries peel stats through as their own aggregate fields', () => {
    const rows: BoardRow[] = [okRow(1, {}, { shortOfTarget: 2, belowMinimum: 1 })];
    const agg = aggregateCell(cell, rows);
    expect(agg.shortOfTarget.mean).toBe(2);
    expect(agg.belowMinimum.mean).toBe(1);
  });
});
