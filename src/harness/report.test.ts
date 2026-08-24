import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import { aggregateCell } from './aggregate.js';
import { defaultCellParams } from './paramGrid.js';
import {
  aggregatesToCsv,
  formatConsoleSummary,
  formatFailures,
  rowsToCsv,
  toJson,
} from './report.js';
import type { BoardRow, BoardRowOk, CellAggregate, CellParams, ParamCell } from './types.js';

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

describe('formatConsoleSummary: telling cells apart', () => {
  function aggregatesOver(overrides: readonly Partial<CellParams>[]): CellAggregate[] {
    return overrides.map((override, cellIndex) => {
      const cellParams = { ...defaultCellParams(), ...override };
      const seeds = [1, 2];
      const rows = seeds.map((seed) => ({
        ...okRow(),
        cellIndex,
        seed,
        params: { ...cellParams, seed },
      }));
      return aggregateCell({ cellIndex, params: cellParams, seeds }, rows);
    });
  }

  it('labels each cell by the axis that varies, not by a fixed set of fields', () => {
    // bendProbability is outside the four fields the header used to name, so
    // every one of these cells printed the same label.
    const text = formatConsoleSummary(
      aggregatesOver([{ bendProbability: 0 }, { bendProbability: 0.5 }, { bendProbability: 1 }]),
    );
    const headers = text.split('\n').filter((line) => line.startsWith('cell '));
    expect(headers).toHaveLength(3);
    expect(new Set(headers).size).toBe(3);
    for (const value of ['bendProbability=0', 'bendProbability=0.5', 'bendProbability=1']) {
      expect(text).toContain(value);
    }
  });

  it('reports what was held constant once rather than on every cell', () => {
    const text = formatConsoleSummary(aggregatesOver([{ gridSize: 20 }, { gridSize: 40 }]));
    expect(text.split('\n').filter((line) => line.startsWith('held: '))).toHaveLength(1);
    expect(text).toContain('fillFraction=');
    expect(text).toContain('gridSize=20');
    expect(text).toContain('gridSize=40');
  });

  it('still names the parameters of a run that sweeps nothing', () => {
    const text = formatConsoleSummary(aggregatesOver([{}]));
    expect(text).toContain('gridSize=');
    expect(text).toContain('no swept axis');
  });
});
