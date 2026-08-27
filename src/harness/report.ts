/** Serializes sweep output: JSON for machine consumption, CSV for a spreadsheet, a plain table for the terminal. */

import type { BoardRow, CellAggregate, CellParams, Stat } from './types.js';

const ROW_COLUMNS = [
  'cellIndex',
  'seed',
  'ok',
  'error',
  'gridSize',
  'meanPieceLength',
  'pieceLengthVariance',
  'minPieceLength',
  'bendProbability',
  'minStraightRun',
  'fillFraction',
  'lobeCount',
  'attempts',
  'generationMs',
  'segmentCount',
  'coverage',
  'meanSegmentLength',
  'bendRate',
  'dagDepth',
  'meanFreeSetSize',
  'minFreeSetSize',
  'edgeCount',
  'shortOfTarget',
  'belowMinimum',
  'wholeRunEscapes',
  'shortStraightRuns',
] as const;

const STAT_METRICS = [
  'generationMs',
  'attempts',
  'segmentCount',
  'coverage',
  'meanSegmentLength',
  'bendRate',
  'dagDepth',
  'meanFreeSetSize',
  'minFreeSetSize',
  'edgeCount',
  'shortOfTarget',
  'belowMinimum',
  'wholeRunEscapes',
  'shortStraightRuns',
] as const satisfies readonly (keyof CellAggregate)[];

type CsvValue = string | number | boolean;

function csvCell(value: CsvValue): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',');
}

function rowValues(row: BoardRow): Record<(typeof ROW_COLUMNS)[number], CsvValue> {
  const base = {
    cellIndex: row.cellIndex,
    seed: row.seed,
    ok: row.ok,
    error: row.ok ? '' : row.error,
    gridSize: row.params.gridSize,
    meanPieceLength: row.params.meanPieceLength,
    pieceLengthVariance: row.params.pieceLengthVariance,
    minPieceLength: row.params.minPieceLength,
    bendProbability: row.params.bendProbability,
    minStraightRun: row.params.minStraightRun,
    fillFraction: row.params.fillFraction,
    lobeCount: row.params.lobeCount,
  };
  if (!row.ok) {
    return {
      ...base,
      attempts: '',
      generationMs: '',
      segmentCount: '',
      coverage: '',
      meanSegmentLength: '',
      bendRate: '',
      dagDepth: '',
      meanFreeSetSize: '',
      minFreeSetSize: '',
      edgeCount: '',
      shortOfTarget: '',
      belowMinimum: '',
      wholeRunEscapes: '',
      shortStraightRuns: '',
    };
  }
  return {
    ...base,
    attempts: row.attempts,
    generationMs: row.metrics.generationMs,
    segmentCount: row.metrics.segmentCount,
    coverage: row.metrics.coverage,
    meanSegmentLength: row.metrics.meanSegmentLength,
    bendRate: row.metrics.bendRate,
    dagDepth: row.metrics.dagDepth,
    meanFreeSetSize: row.metrics.meanFreeSetSize,
    minFreeSetSize: row.metrics.minFreeSetSize,
    edgeCount: row.metrics.edgeCount,
    shortOfTarget: row.peel.shortOfTarget,
    belowMinimum: row.peel.belowMinimum,
    wholeRunEscapes: row.peel.wholeRunEscapes,
    shortStraightRuns: row.peel.shortStraightRuns,
  };
}

export function rowsToCsv(rows: readonly BoardRow[]): string {
  const lines = [csvLine(ROW_COLUMNS)];
  for (const row of rows) {
    const values = rowValues(row);
    lines.push(csvLine(ROW_COLUMNS.map((c) => values[c])));
  }
  return lines.join('\n') + '\n';
}

const AGG_PREFIX_COLUMNS = [
  'cellIndex',
  'gridSize',
  'meanPieceLength',
  'pieceLengthVariance',
  'minPieceLength',
  'bendProbability',
  'minStraightRun',
  'fillFraction',
  'lobeCount',
  'seedCount',
  'failureCount',
  'failedSeeds',
] as const;

function statColumns(metric: string): readonly string[] {
  return [`${metric}Mean`, `${metric}Min`, `${metric}Max`];
}

export function aggregatesToCsv(aggregates: readonly CellAggregate[]): string {
  const header = [...AGG_PREFIX_COLUMNS, ...STAT_METRICS.flatMap((m) => statColumns(m))];
  const lines = [csvLine(header)];
  for (const agg of aggregates) {
    const prefix: CsvValue[] = [
      agg.cellIndex,
      agg.params.gridSize,
      agg.params.meanPieceLength,
      agg.params.pieceLengthVariance,
      agg.params.minPieceLength,
      agg.params.bendProbability,
      agg.params.minStraightRun,
      agg.params.fillFraction,
      agg.params.lobeCount,
      agg.seedCount,
      agg.failureCount,
      agg.failedSeeds.join(';'),
    ];
    const statValues: CsvValue[] = STAT_METRICS.flatMap((m) => {
      const s: Stat = agg[m];
      return [s.mean, s.min, s.max];
    });
    lines.push(csvLine([...prefix, ...statValues]));
  }
  return lines.join('\n') + '\n';
}

export interface JsonReport {
  readonly rows: readonly BoardRow[];
  readonly aggregates: readonly CellAggregate[];
}

export function toJson(rows: readonly BoardRow[], aggregates: readonly CellAggregate[]): string {
  const report: JsonReport = { rows, aggregates };
  return JSON.stringify(report, replaceTypedArrays, 2) + '\n';
}

function replaceTypedArrays(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value;
}

function round(n: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** The parameter keys whose value is not the same in every cell. */
function sweptAxes(aggregates: readonly CellAggregate[]): (keyof CellParams)[] {
  const first = aggregates[0];
  if (first === undefined) return [];
  const keys = Object.keys(first.params) as (keyof CellParams)[];
  return keys.filter((key) => aggregates.some((agg) => agg.params[key] !== first.params[key]));
}

function describeParams(params: CellParams, keys: readonly (keyof CellParams)[]): string {
  return keys.map((key) => `${key}=${String(params[key])}`).join(' ');
}

export function formatConsoleSummary(aggregates: readonly CellAggregate[]): string {
  const first = aggregates[0];
  if (first === undefined) return '';

  // A header built from a fixed list of parameters labels every cell of a
  // sweep over anything else identically, which reads as the axis making no
  // difference. So the axes are whatever actually varies, and the rest is
  // context that only needs saying once.
  const axes = sweptAxes(aggregates);
  const allKeys = Object.keys(first.params) as (keyof CellParams)[];
  const held = allKeys.filter((key) => !axes.includes(key));

  const lines: string[] = [];
  if (held.length > 0) lines.push(`held: ${describeParams(first.params, held)}`);

  for (const agg of aggregates) {
    const label = axes.length > 0 ? describeParams(agg.params, axes) : 'no swept axis';
    lines.push(
      `cell ${agg.cellIndex}  ${label}  seeds=${agg.seedCount} failures=${agg.failureCount}`,
    );
    lines.push(
      `  generationMs mean=${round(agg.generationMs.mean)} max=${round(agg.generationMs.max)}  ` +
        `segments mean=${round(agg.segmentCount.mean)} len=${round(agg.meanSegmentLength.mean)}  ` +
        `coverage min=${round(agg.coverage.min)}  bendRate mean=${round(agg.bendRate.mean)}`,
    );
    lines.push(
      `  dagDepth mean=${round(agg.dagDepth.mean)} max=${round(agg.dagDepth.max)}  ` +
        `meanFreeSetSize mean=${round(agg.meanFreeSetSize.mean)}  minFreeSetSize mean=${round(agg.minFreeSetSize.mean)}  ` +
        `belowMinimum max=${round(agg.belowMinimum.max)}`,
    );
    if (agg.failureCount > 0) {
      lines.push(`  failed seeds: ${agg.failedSeeds.join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function formatFailures(rows: readonly BoardRow[]): string {
  const failed = rows.filter((r): r is Extract<BoardRow, { ok: false }> => !r.ok);
  if (failed.length === 0) return '';
  const lines = [`${failed.length} board(s) failed:`];
  for (const row of failed) {
    lines.push(
      `  cell ${row.cellIndex} seed ${row.seed} (grid=${row.params.gridSize}): ${row.error}`,
    );
  }
  return lines.join('\n');
}
