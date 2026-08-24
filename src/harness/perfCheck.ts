/** Compares a fixed-seed harness run against a committed baseline. Pure: no fs, no console, no clock. */

import type { CellAggregate, ParamCell } from './types.js';
import type { Seed } from '../core/types.js';

export class PerfCheckError extends Error {}

export const DEFAULT_THRESHOLD_MULTIPLIER = 2;

export interface PerfBaselineEntry {
  readonly gridSize: number;
  readonly seedCount: number;
  readonly meanMs: number;
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
    const cell = cells.find((c) => c.params.gridSize === entry.gridSize);
    const agg = aggregates.find((a) => a.params.gridSize === entry.gridSize);
    if (cell === undefined || agg === undefined) {
      return {
        status: 'broken',
        gridSize: entry.gridSize,
        reason: `no run recorded for gridSize ${entry.gridSize}`,
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
  return { ok: cellVerdicts.every((v) => v.status === 'ok'), cells: cellVerdicts };
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
    const meanMs = requireFiniteNumber(record.meanMs, `baseline cells[${i}].meanMs`);
    const maxMs = requireFiniteNumber(record.maxMs, `baseline cells[${i}].maxMs`);
    if (seen.has(gridSize)) {
      throw new PerfCheckError(`baseline has more than one entry for gridSize ${gridSize}`);
    }
    seen.add(gridSize);
    return { gridSize, seedCount, meanMs, maxMs };
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
      meanMs: agg.generationMs.mean,
      maxMs: agg.generationMs.max,
    };
  });
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
