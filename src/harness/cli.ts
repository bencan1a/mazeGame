#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { aggregateCells } from './aggregate.js';
import { HELP_TEXT, HarnessArgError, parseCliArgs } from './args.js';
import { SweepSpecError, cellsFromSingle, cellsFromSweepSpec } from './paramGrid.js';
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
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new SweepSpecError(`cannot read sweep spec "${path}"`);
  }
  try {
    return JSON.parse(text) as SweepSpec;
  } catch (err) {
    throw new SweepSpecError(`sweep spec "${path}" is not valid JSON: ${(err as Error).message}`);
  }
}

function buildCells(args: ReturnType<typeof parseCliArgs>['mode']): ParamCell[] {
  if (args.mode === 'sweep') return cellsFromSweepSpec(readSweepSpec(args.specPath));
  return cellsFromSingle({ seeds: args.seeds, seedBase: args.seedBase, overrides: args.overrides });
}

/**
 * Sibling path for the aggregate rows. The extension is looked for in the last
 * path segment only — a dot in a directory name is not one.
 */
function csvOutputPath(base: string): string {
  const cut = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  const dot = base.lastIndexOf('.');
  if (dot <= cut) return `${base}.agg.csv`;
  return `${base.slice(0, dot)}.agg${base.slice(dot)}`;
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

  let cells;
  try {
    cells = buildCells(args.mode);
  } catch (err) {
    if (err instanceof SweepSpecError) {
      console.error(err.message);
      console.error(HELP_TEXT);
      return 1;
    }
    throw err;
  }
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
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}
