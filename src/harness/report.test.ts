import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import { aggregateCell } from './aggregate.js';
import { defaultCellParams } from './paramGrid.js';
import { aggregatesToCsv, formatFailures, rowsToCsv, toJson } from './report.js';
import type { BoardRow, BoardRowOk, ParamCell } from './types.js';

const params = { ...DEFAULT_GEN_PARAMS, seed: 1 };

function okRow(): BoardRowOk {
  return {
    cellIndex: 0,
    seed: 1,
    params,
    ok: true,
    attempts: 1,
    metrics: {
      segmentCount: 10,
      coverage: 1,
      meanSegmentLength: 4,
      bendRate: 0.3,
      dagDepth: 5,
      meanFreeSetSize: 3,
      minFreeSetSize: 2,
      edgeCount: 12,
      generationMs: 10,
    },
    peel: {
      segmentCount: 10,
      meanLength: 4,
      lengthStdDev: 1,
      shortOfTarget: 1,
      belowMinimum: 0,
      wholeRunEscapes: 0,
      shortStraightRuns: 0,
    },
  };
}

const failedRow: BoardRow = {
  cellIndex: 0,
  seed: 2,
  params: { ...DEFAULT_GEN_PARAMS, seed: 2 },
  ok: false,
  error: 'exhausted 8 attempt(s), a comma, here',
};

const cell: ParamCell = { cellIndex: 0, params: defaultCellParams(), seeds: [1, 2] };

describe('rowsToCsv', () => {
  it('emits one header row and one row per board', () => {
    const csv = rowsToCsv([okRow(), failedRow]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('cellIndex,seed,ok,error,gridSize');
  });

  it('quotes a field containing a comma', () => {
    const csv = rowsToCsv([failedRow]);
    expect(csv).toContain('"exhausted 8 attempt(s), a comma, here"');
  });

  it('leaves metric columns blank for a failed row', () => {
    const csv = rowsToCsv([failedRow]);
    const [, dataLine] = csv.trim().split('\n');
    expect(dataLine).toMatch(/^0,2,false,/);
  });
});

describe('aggregatesToCsv', () => {
  it('emits mean/min/max columns per metric', () => {
    const agg = aggregateCell(cell, [okRow()]);
    const csv = aggregatesToCsv([agg]);
    expect(csv).toContain('dagDepthMean,dagDepthMin,dagDepthMax');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});

describe('toJson', () => {
  it('round-trips rows and aggregates through JSON.parse', () => {
    const agg = aggregateCell(cell, [okRow()]);
    const parsed = JSON.parse(toJson([okRow()], [agg])) as {
      rows: unknown[];
      aggregates: unknown[];
    };
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.aggregates).toHaveLength(1);
  });
});

describe('formatFailures', () => {
  it('is empty when nothing failed', () => {
    expect(formatFailures([okRow()])).toBe('');
  });

  it('names the seed of every failed board', () => {
    const text = formatFailures([okRow(), failedRow]);
    expect(text).toContain('seed 2');
    expect(text).toContain(failedRow.error);
  });
});
