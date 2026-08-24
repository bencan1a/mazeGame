/** Compares a fixed-seed harness run against a committed baseline. Pure: no fs, no console, no clock. */

import type { CellAggregate, ParamCell } from './types.js';
import type { Seed } from '../core/types.js';

export class PerfCheckError extends Error {}

/**
 * Wide because the baseline is recorded wherever a contributor happens to run
 * it and compared on a shared runner, so an unchanged commit already lands
 * well above 1x. It still catches the order-of-magnitude regression this
 * exists for.
 */
export const DEFAULT_THRESHOLD_MULTIPLIER = 3;

export interface PerfBaselineEntry {
  readonly gridSize: number;
  readonly seedCount: number;
  /** Every generator input the timing depends on, so a change to the defaults
   * or the spec cannot be compared against numbers measured under others. */
  readonly params: Readonly<Record<string, number>>;
  readonly meanMs: number;
  /** Context for whoever reads a baseline diff. Runner noise makes a single
   * board's peak too jumpy to compare, so nothing checks this. */
  readonly maxMs: number;
}

export interface PerfBaseline {
  readonly cells: readonly PerfBaselineEntry[];
}

export interface PerfCellMeasured {
  readonly status: 'ok' | 'regressed';
  readonly gridSize: number;
  readonly seeds: readonly Seed[];
  readonly meanMs: number;
  readonly baselineMeanMs: number;
  readonly thresholdMs: number;
}

export interface PerfCellBroken {
  readonly status: 'broken';
  readonly gridSize: number;
  readonly reason: string;
}

export type PerfCellVerdict = PerfCellMeasured | PerfCellBroken;

export interface PerfCheckReport {
  readonly ok: boolean;
  readonly cells: readonly PerfCellVerdict[];
}

const DISCLAIMER =
  'Relative regression check on a shared CI runner, against a committed baseline. ' +
  'This is not a device measurement and says nothing about the 1s generation ' +
  'target at 100x100 — that is only settled by running on a phone.';

export function getDisclaimer(): string {
  return DISCLAIMER;
}

/**
 * One verdict per baseline entry, not per aggregate — a size the run never
 * produced a matching aggregate for is `broken`, not skipped.
 */
export function evaluatePerfCheck(
  cells: readonly ParamCell[],
  aggregates: readonly CellAggregate[],
  baseline: PerfBaseline,
  thresholdMultiplier: number,
): PerfCheckReport {
  const cellVerdicts = baseline.cells.map((entry): PerfCellVerdict => {
    const matchingCells = cells.filter((c) => c.params.gridSize === entry.gridSize);
    const matchingAggs = aggregates.filter((a) => a.params.gridSize === entry.gridSize);
    const cell = matchingCells[0];
    const agg = matchingAggs[0];
    if (cell === undefined || agg === undefined) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason: `no run recorded for gridSize ${entry.gridSize}`,
      };
    }
    // More than one cell per gridSize means the spec grew an axis the baseline
    // knows nothing about, so whichever came first would be compared against a
    // number recorded for something else.
    if (matchingAggs.length > 1) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason:
          `the sweep produced ${matchingAggs.length} cells at gridSize ${entry.gridSize}; ` +
          'the baseline holds one figure per size, so re-record it against the current spec',
      };
    }
    const drifted = paramsDrift(entry.params, agg.params);
    if (drifted.length > 0) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason:
          `gridSize ${entry.gridSize} ran with ${drifted.join(', ')} — the baseline was ` +
          'recorded under different generator inputs, so re-record it',
      };
    }
    if (agg.seedCount !== entry.seedCount) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason:
          `gridSize ${entry.gridSize} ran ${agg.seedCount} seed(s) against a baseline ` +
          `recorded over ${entry.seedCount}; re-record the baseline against the current spec`,
      };
    }
    if (agg.seedCount === 0) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason: `no seeds were run for gridSize ${entry.gridSize}`,
      };
    }
    if (agg.failureCount > 0) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason:
          `${agg.failureCount} of ${agg.seedCount} board(s) failed to generate at ` +
          `gridSize ${entry.gridSize} (seeds ${agg.failedSeeds.join(', ')})`,
      };
    }
    const meanMs = agg.generationMs.mean;
    const thresholdMs = entry.meanMs * thresholdMultiplier;
    return {
      status: meanMs > thresholdMs ? 'regressed' : 'ok',
      gridSize: entry.gridSize,
      seeds: cell.seeds,
      meanMs,
      baselineMeanMs: entry.meanMs,
      thresholdMs,
    };
  });
  const baselineSizes = new Set(baseline.cells.map((c) => c.gridSize));
  const unbaselined = aggregates
    .map((a) => a.params.gridSize)
    .filter((size) => !baselineSizes.has(size));
  const extras: PerfCellVerdict[] = [...new Set(unbaselined)].map((gridSize) => ({
    status: 'broken',
    gridSize,
    reason: `the spec sweeps gridSize ${gridSize} but the baseline has no entry for it`,
  }));

  const all = [...cellVerdicts, ...extras];
  return { ok: all.every((v) => v.status === 'ok'), cells: all };
}

/** Names every input whose value differs between the baseline and this run. */
function paramsDrift(
  baseline: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): string[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(actual)]);
  const drifted: string[] = [];
  for (const key of [...keys].sort()) {
    if (baseline[key] !== actual[key]) {
      drifted.push(`${key} ${String(actual[key])} against ${String(baseline[key])}`);
    }
  }
  return drifted;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PerfCheckError(`${label} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Parses and validates a baseline file's already-JSON.parsed contents. */
export function parseBaseline(raw: unknown): PerfBaseline {
  if (raw === null || typeof raw !== 'object' || !('cells' in raw)) {
    throw new PerfCheckError('baseline must be a JSON object with a "cells" array');
  }
  const cellsRaw = raw.cells;
  if (!Array.isArray(cellsRaw) || cellsRaw.length === 0) {
    throw new PerfCheckError('baseline "cells" must be a non-empty array');
  }
  const seen = new Set<number>();
  const cells = cellsRaw.map((entry, i): PerfBaselineEntry => {
    if (entry === null || typeof entry !== 'object') {
      throw new PerfCheckError(`baseline cells[${i}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const gridSize = requireFiniteNumber(record.gridSize, `baseline cells[${i}].gridSize`);
    const seedCount = requireFiniteNumber(record.seedCount, `baseline cells[${i}].seedCount`);
    const rawParams = record.params;
    if (rawParams === null || typeof rawParams !== 'object') {
      throw new PerfCheckError(`baseline cells[${i}].params is missing or not an object`);
    }
    const params: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawParams as Record<string, unknown>)) {
      params[key] = requireFiniteNumber(value, `baseline cells[${i}].params.${key}`);
    }
    const meanMs = requireFiniteNumber(record.meanMs, `baseline cells[${i}].meanMs`);
    if (meanMs <= 0) {
      // A threshold of zero reports every future run as a regression, for ever.
      throw new PerfCheckError(`baseline cells[${i}].meanMs is ${meanMs}, expected above zero`);
    }
    const maxMs = requireFiniteNumber(record.maxMs, `baseline cells[${i}].maxMs`);
    if (seen.has(gridSize)) {
      throw new PerfCheckError(`baseline has more than one entry for gridSize ${gridSize}`);
    }
    seen.add(gridSize);
    return { gridSize, seedCount, params, meanMs, maxMs };
  });
  return { cells };
}

/** Builds a fresh baseline from a run with no failures. Refuses to bless a broken measurement. */
export function baselineFromAggregates(aggregates: readonly CellAggregate[]): PerfBaseline {
  if (aggregates.length === 0) {
    throw new PerfCheckError('cannot build a baseline from zero cells');
  }
  const cells = aggregates.map((agg): PerfBaselineEntry => {
    if (agg.seedCount === 0) {
      throw new PerfCheckError(`gridSize ${agg.params.gridSize} ran zero seeds`);
    }
    if (agg.failureCount > 0) {
      throw new PerfCheckError(
        `gridSize ${agg.params.gridSize} had ${agg.failureCount} failed board(s); ` +
          'fix generation before recording a baseline from this run',
      );
    }
    return {
      gridSize: agg.params.gridSize,
      seedCount: agg.seedCount,
      params: { ...agg.params },
      meanMs: agg.generationMs.mean,
      maxMs: agg.generationMs.max,
    };
  });
  const seen = new Set<number>();
  for (const cell of cells) {
    if (seen.has(cell.gridSize)) {
      throw new PerfCheckError(
        `the sweep produced more than one cell at gridSize ${cell.gridSize}; a baseline holds ` +
          'one figure per size, so the spec must vary nothing but gridSize',
      );
    }
    seen.add(cell.gridSize);
  }
  return { cells: [...cells].sort((a, b) => a.gridSize - b.gridSize) };
}

export function serializeBaseline(baseline: PerfBaseline): string {
  return JSON.stringify(baseline, null, 2) + '\n';
}

function formatCellLine(cell: PerfCellVerdict): string {
  if (cell.status === 'broken') return `gridSize=${cell.gridSize}: BROKEN — ${cell.reason}`;
  const verdict = cell.status === 'regressed' ? 'REGRESSED' : 'ok';
  return (
    `gridSize=${cell.gridSize}: ${verdict}  mean=${cell.meanMs.toFixed(1)}ms  ` +
    `baseline=${cell.baselineMeanMs.toFixed(1)}ms  threshold=${cell.thresholdMs.toFixed(1)}ms  ` +
    `seeds=${cell.seeds.join(',')}`
  );
}

export function formatPerfReport(report: PerfCheckReport, reproCommand: string): string {
  const lines = [DISCLAIMER, '', ...report.cells.map(formatCellLine)];
  if (!report.ok) lines.push('', 'Reproduce locally:', `  ${reproCommand}`);
  return lines.join('\n');
}

function markdownRow(cell: PerfCellVerdict): string {
  if (cell.status === 'broken') {
    return `| ${cell.gridSize} | broken | — | — | — | ${cell.reason} |`;
  }
  const verdict = cell.status === 'regressed' ? '**REGRESSED**' : 'ok';
  return (
    `| ${cell.gridSize} | ${verdict} | ${cell.meanMs.toFixed(1)} | ${cell.baselineMeanMs.toFixed(1)} | ` +
    `${cell.thresholdMs.toFixed(1)} | seeds ${cell.seeds.join(',')} |`
  );
}

export function formatPerfSummaryMarkdown(report: PerfCheckReport, reproCommand: string): string {
  const header =
    '| grid | verdict | mean ms | baseline ms | threshold ms | detail |\n' +
    '|---|---|---|---|---|---|';
  const rows = report.cells.map(markdownRow).join('\n');
  const footer = report.ok ? '' : `\n\nReproduce locally:\n\n\`\`\`\n${reproCommand}\n\`\`\`\n`;
  return `## Generation-time regression check\n\n${DISCLAIMER}\n\n${header}\n${rows}\n${footer}`;
}
