import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import type { GenParams, BoardMetrics } from '../core/types.js';
import type { PeelStats } from '../core/segment/index.js';
import { aggregateCell } from './aggregate.js';
import { defaultCellParams } from './paramGrid.js';
import type { BoardRow, BoardRowOk, CellAggregate, ParamCell } from './types.js';
import {
  baselineFromAggregates,
  evaluatePerfCheck,
  formatPerfReport,
  formatPerfSummaryMarkdown,
  parseBaseline,
  PerfCheckError,
  serializeBaseline,
} from './perfCheck.js';
import type { PerfBaseline } from './perfCheck.js';

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

function peel(overrides: Partial<PeelStats> = {}): PeelStats {
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

function okRow(seed: number, gridSize: number, generationMs: number): BoardRowOk {
  const params: GenParams = { ...DEFAULT_GEN_PARAMS, seed, gridSize };
  return {
    cellIndex: 0,
    seed,
    params,
    ok: true,
    attempts: 1,
    metrics: metrics({ generationMs }),
    peel: peel(),
  };
}

function failedRow(seed: number, gridSize: number): BoardRow {
  return {
    cellIndex: 0,
    seed,
    params: { ...DEFAULT_GEN_PARAMS, seed, gridSize },
    ok: false,
    error: 'boom',
  };
}

function cellAt(gridSize: number, seeds: readonly number[]): ParamCell {
  return { cellIndex: 0, params: { ...defaultCellParams(), gridSize }, seeds };
}

function aggAt(
  gridSize: number,
  rows: readonly BoardRow[],
  seeds: readonly number[],
): CellAggregate {
  return aggregateCell(cellAt(gridSize, seeds), rows);
}

describe('evaluatePerfCheck', () => {
  it('is ok when the measured mean is at or under the threshold', () => {
    const seeds = [1, 2, 3];
    const cells = [cellAt(40, seeds)];
    const rows = seeds.map((s) => okRow(s, 40, 10));
    const aggregates = [aggAt(40, rows, seeds)];
    const baseline: PerfBaseline = {
      cells: [{ gridSize: 40, seedCount: 3, meanMs: 10, maxMs: 10 }],
    };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(true);
    expect(report.cells).toEqual([
      { status: 'ok', gridSize: 40, seeds, meanMs: 10, baselineMeanMs: 10, thresholdMs: 20 },
    ]);
  });

  it('flags a mean over threshold as regressed, naming the seeds', () => {
    const seeds = [1, 2];
    const cells = [cellAt(100, seeds)];
    const rows = seeds.map((s) => okRow(s, 100, 50));
    const aggregates = [aggAt(100, rows, seeds)];
    const baseline: PerfBaseline = {
      cells: [{ gridSize: 100, seedCount: 2, meanMs: 20, maxMs: 20 }],
    };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(false);
    expect(report.cells[0]).toMatchObject({ status: 'regressed', gridSize: 100, seeds });
  });

  it('is broken, not vacuously ok, when every board at a size failed to generate', () => {
    const seeds = [1, 2];
    const cells = [cellAt(40, seeds)];
    const rows = seeds.map((s) => failedRow(s, 40));
    const aggregates = [aggAt(40, rows, seeds)];
    const baseline: PerfBaseline = {
      cells: [{ gridSize: 40, seedCount: 2, meanMs: 10, maxMs: 10 }],
    };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(false);
    expect(report.cells[0]?.status).toBe('broken');
    if (report.cells[0]?.status === 'broken') {
      expect(report.cells[0].reason).toContain('2 of 2');
    }
  });

  it('is broken when a partial failure hides among otherwise-fast boards', () => {
    const seeds = [1, 2, 3];
    const cells = [cellAt(40, seeds)];
    const rows = [okRow(1, 40, 5), okRow(2, 40, 5), failedRow(3, 40)];
    const aggregates = [aggAt(40, rows, seeds)];
    const baseline: PerfBaseline = { cells: [{ gridSize: 40, seedCount: 3, meanMs: 5, maxMs: 5 }] };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(false);
    expect(report.cells[0]?.status).toBe('broken');
  });

  it('is broken when the baseline names a size the run never covered', () => {
    const seeds = [1];
    const cells = [cellAt(40, seeds)];
    const rows = seeds.map((s) => okRow(s, 40, 5));
    const aggregates = [aggAt(40, rows, seeds)];
    const baseline: PerfBaseline = {
      cells: [{ gridSize: 100, seedCount: 1, meanMs: 5, maxMs: 5 }],
    };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(false);
    expect(report.cells[0]).toMatchObject({ status: 'broken', gridSize: 100 });
  });

  it('is broken when a cell ran zero seeds', () => {
    const cells = [cellAt(40, [])];
    const aggregates = [aggAt(40, [], [])];
    const baseline: PerfBaseline = { cells: [{ gridSize: 40, seedCount: 0, meanMs: 5, maxMs: 5 }] };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(false);
    expect(report.cells[0]?.status).toBe('broken');
  });

  it('evaluates every baseline size independently', () => {
    const seeds40 = [1, 2];
    const seeds100 = [3, 4];
    const cells = [cellAt(40, seeds40), cellAt(100, seeds100)];
    const rows40 = seeds40.map((s) => okRow(s, 40, 5));
    const rows100 = seeds100.map((s) => okRow(s, 100, 500));
    const aggregates = [aggAt(40, rows40, seeds40), aggAt(100, rows100, seeds100)];
    const baseline: PerfBaseline = {
      cells: [
        { gridSize: 40, seedCount: 2, meanMs: 5, maxMs: 5 },
        { gridSize: 100, seedCount: 2, meanMs: 5, maxMs: 5 },
      ],
    };

    const report = evaluatePerfCheck(cells, aggregates, baseline, 2);
    expect(report.ok).toBe(false);
    expect(report.cells.map((c) => c.status)).toEqual(['ok', 'regressed']);
  });
});

describe('parseBaseline', () => {
  it('parses a well-formed baseline', () => {
    const baseline = parseBaseline({
      cells: [{ gridSize: 40, seedCount: 10, meanMs: 15, maxMs: 30 }],
    });
    expect(baseline.cells).toHaveLength(1);
  });

  it('rejects a baseline with no cells array', () => {
    expect(() => parseBaseline({})).toThrow(PerfCheckError);
  });

  it('rejects an empty cells array', () => {
    expect(() => parseBaseline({ cells: [] })).toThrow(/non-empty/);
  });

  it('rejects a non-numeric field', () => {
    expect(() =>
      parseBaseline({ cells: [{ gridSize: 40, seedCount: 10, meanMs: '15', maxMs: 30 }] }),
    ).toThrow(/finite number/);
  });

  it('rejects a duplicate gridSize', () => {
    expect(() =>
      parseBaseline({
        cells: [
          { gridSize: 40, seedCount: 10, meanMs: 15, maxMs: 30 },
          { gridSize: 40, seedCount: 10, meanMs: 16, maxMs: 31 },
        ],
      }),
    ).toThrow(/more than one entry/);
  });

  it('round-trips through serializeBaseline', () => {
    const baseline: PerfBaseline = { cells: [{ gridSize: 40, seedCount: 5, meanMs: 1, maxMs: 2 }] };
    expect(parseBaseline(JSON.parse(serializeBaseline(baseline)))).toEqual(baseline);
  });
});

describe('baselineFromAggregates', () => {
  it('builds one entry per aggregate, sorted by gridSize', () => {
    const seeds = [1, 2];
    const rows100 = seeds.map((s) => okRow(s, 100, 50));
    const rows40 = seeds.map((s) => okRow(s, 40, 5));
    const aggregates = [aggAt(100, rows100, seeds), aggAt(40, rows40, seeds)];

    const baseline = baselineFromAggregates(aggregates);
    expect(baseline.cells.map((c) => c.gridSize)).toEqual([40, 100]);
    expect(baseline.cells[0]?.meanMs).toBe(5);
  });

  it('refuses to record a baseline built on a failed board', () => {
    const seeds = [1, 2];
    const rows = [okRow(1, 40, 5), failedRow(2, 40)];
    const aggregates = [aggAt(40, rows, seeds)];
    expect(() => baselineFromAggregates(aggregates)).toThrow(PerfCheckError);
  });

  it('refuses to build a baseline from zero cells', () => {
    expect(() => baselineFromAggregates([])).toThrow(PerfCheckError);
  });
});

describe('formatPerfReport', () => {
  it('includes the disclaimer on every run, pass or fail', () => {
    const okReport = { ok: true, cells: [] };
    expect(formatPerfReport(okReport, 'repro')).toMatch(/not a device measurement/);
  });

  it('includes the reproduction command only when something is wrong', () => {
    const okReport = { ok: true, cells: [] };
    const failedReport = {
      ok: false,
      cells: [{ status: 'broken' as const, gridSize: 40, reason: 'boom' }],
    };
    expect(formatPerfReport(okReport, 'repro-command')).not.toContain('repro-command');
    expect(formatPerfReport(failedReport, 'repro-command')).toContain('repro-command');
  });
});

describe('formatPerfSummaryMarkdown', () => {
  it('renders a markdown table with one row per cell', () => {
    const report = {
      ok: true,
      cells: [
        {
          status: 'ok' as const,
          gridSize: 40,
          seeds: [1, 2],
          meanMs: 10,
          baselineMeanMs: 12,
          thresholdMs: 24,
        },
      ],
    };
    const markdown = formatPerfSummaryMarkdown(report, 'repro-command');
    expect(markdown).toContain('| 40 |');
    expect(markdown).not.toContain('repro-command');
  });
});
