#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { aggregateCells } from './aggregate.js';
import { HELP_TEXT, HarnessArgError, parseCliArgs } from './args.js';
import { cellsFromSingle, cellsFromSweepSpec } from './paramGrid.js';
import {
  aggregatesToCsv,
  formatConsoleSummary,
  formatFailures,
  rowsToCsv,
  toJson,
} from './report.js';
import { runCells } from './run.js';
import type { ParamCell, SweepSpec } from './types.js';

function readSweepSpec(path: string): SweepSpec {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text) as SweepSpec;
}

function buildCells(args: ReturnType<typeof parseCliArgs>['mode']): ParamCell[] {
  if (args.mode === 'sweep') return cellsFromSweepSpec(readSweepSpec(args.specPath));
  return cellsFromSingle({ seeds: args.seeds, seedBase: args.seedBase, overrides: args.overrides });
}

function csvOutputPath(base: string): string {
  const dot = base.lastIndexOf('.');
  return dot === -1 ? `${base}.agg.csv` : `${base.slice(0, dot)}.agg${base.slice(dot)}`;
}

export function main(argv: readonly string[]): number {
  let args;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof HarnessArgError) {
      console.error(err.message);
      console.error(HELP_TEXT);
      return 1;
    }
    throw err;
  }

  if (args.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  const cells = buildCells(args.mode);
  const runOptions = args.maxAttempts === undefined ? {} : { maxAttempts: args.maxAttempts };
  const rows = runCells(cells, runOptions);
  const aggregates = aggregateCells(cells, rows);

  if (args.json !== undefined) {
    writeFileSync(args.json, toJson(rows, aggregates));
    console.log(`wrote ${rows.length} row(s) and ${aggregates.length} cell(s) to ${args.json}`);
  }
  if (args.csv !== undefined) {
    writeFileSync(args.csv, rowsToCsv(rows));
    const aggPath = csvOutputPath(args.csv);
    writeFileSync(aggPath, aggregatesToCsv(aggregates));
    console.log(
      `wrote ${rows.length} row(s) to ${args.csv} and ${aggregates.length} cell(s) to ${aggPath}`,
    );
  }
  if (args.json === undefined && args.csv === undefined) {
    console.log(formatConsoleSummary(aggregates));
  }

  const failureText = formatFailures(rows);
  if (failureText !== '') console.error(failureText);

  return rows.some((r) => !r.ok) ? 1 : 0;
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}
