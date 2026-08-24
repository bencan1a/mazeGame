#!/usr/bin/env node
/** CI entry point for the generation-time regression check. Reads/writes files and prints; the comparison itself lives in perfCheck.ts. */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { aggregateCells } from './aggregate.js';
import { cellsFromSweepSpec, SweepSpecError } from './paramGrid.js';
import {
  DEFAULT_THRESHOLD_MULTIPLIER,
  PerfCheckError,
  baselineFromAggregates,
  evaluatePerfCheck,
  formatPerfReport,
  formatPerfSummaryMarkdown,
  parseBaseline,
  serializeBaseline,
} from './perfCheck.js';
import { runCells } from './run.js';
import type { Clock } from './run.js';
import type { SweepSpec } from './types.js';

const DEFAULT_SPEC_PATH = 'src/harness/perf-regression.sweep.json';
const DEFAULT_BASELINE_PATH = 'src/harness/perf-baseline.json';

const OPTIONS = {
  spec: { type: 'string' },
  baseline: { type: 'string' },
  threshold: { type: 'string' },
  'update-baseline': { type: 'boolean' },
  'max-attempts': { type: 'string' },
  'summary-file': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

const HELP_TEXT = `Usage:
  perfCheckCli [--spec FILE] [--baseline FILE] [--threshold N] [--max-attempts N]
  perfCheckCli --update-baseline [--spec FILE] [--baseline FILE]

Runs the fixed seed set in --spec (a harness sweep spec) and compares
generationMs per gridSize against --baseline, a committed JSON file.
Exits non-zero on a regression or on a run this check cannot trust
(a missing baseline, a failed board, a size the spec never covered).

Options:
  --spec FILE            sweep spec to run (default ${DEFAULT_SPEC_PATH})
  --baseline FILE         committed baseline (default ${DEFAULT_BASELINE_PATH})
  --threshold N            regression multiplier over baseline mean (default ${DEFAULT_THRESHOLD_MULTIPLIER})
  --max-attempts N          generateBoardWithDiagnostics retry budget
  --update-baseline        overwrite --baseline with this run's numbers instead of comparing
  --summary-file FILE       markdown summary destination (default $GITHUB_STEP_SUMMARY, if set)
  --help                   print this message`;

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new PerfCheckError(`cannot read ${what} "${path}"`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new PerfCheckError(`${what} "${path}" is not valid JSON: ${(err as Error).message}`);
  }
}

/** A path is pasted into a shell, so a space in it has to survive the trip. */
function shellQuote(value: string): string {
  if (/^[\w./-]+$/.test(value)) return value;
  return `'${value.split("'").join(`'\\''`)}'`;
}

function reproCommand(specPath: string, baselinePath: string, threshold: number): string {
  return (
    `npx tsx src/harness/perfCheckCli.ts --spec ${shellQuote(specPath)} ` +
    `--baseline ${shellQuote(baselinePath)} --threshold ${threshold}`
  );
}

export interface MainDeps {
  readonly clock?: Clock;
}

export function main(argv: readonly string[], deps: MainDeps = {}): number {
  let values;
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: false }));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(HELP_TEXT);
    return 1;
  }

  if (values.help === true) {
    console.log(HELP_TEXT);
    return 0;
  }

  const specPath = values.spec ?? DEFAULT_SPEC_PATH;
  const baselinePath = values.baseline ?? DEFAULT_BASELINE_PATH;
  const thresholdRaw = values.threshold;
  const threshold =
    thresholdRaw === undefined ? DEFAULT_THRESHOLD_MULTIPLIER : Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold <= 1) {
    console.error(`--threshold must be a number greater than 1, got "${String(thresholdRaw)}"`);
    return 1;
  }
  const maxAttemptsRaw = values['max-attempts'];
  const maxAttempts = maxAttemptsRaw === undefined ? undefined : Number(maxAttemptsRaw);
  if (maxAttempts !== undefined && !Number.isFinite(maxAttempts)) {
    console.error(`--max-attempts must be a number, got "${maxAttemptsRaw}"`);
    return 1;
  }

  let cells;
  try {
    const spec = readJson(specPath, 'sweep spec') as SweepSpec;
    cells = cellsFromSweepSpec(spec);
  } catch (err) {
    if (err instanceof SweepSpecError || err instanceof PerfCheckError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  if (cells.length === 0) {
    console.error(`sweep spec "${specPath}" produced zero cells to run`);
    return 1;
  }

  const runOptions = {
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  };
  const rows = runCells(cells, runOptions);
  const aggregates = aggregateCells(cells, rows);

  if (values['update-baseline'] === true) {
    let baseline;
    try {
      baseline = baselineFromAggregates(aggregates);
    } catch (err) {
      if (err instanceof PerfCheckError) {
        console.error(err.message);
        return 1;
      }
      throw err;
    }
    writeFileSync(baselinePath, serializeBaseline(baseline));
    console.log(`wrote ${baseline.cells.length} cell(s) to ${baselinePath}`);
    console.log('Review the diff and commit it deliberately, with a note on why it moved.');
    return 0;
  }

  let baseline;
  try {
    baseline = parseBaseline(readJson(baselinePath, 'baseline'));
  } catch (err) {
    if (err instanceof PerfCheckError) {
      console.error(err.message);
      console.error(
        `Run with --update-baseline to record one deliberately, then commit ${baselinePath}.`,
      );
      return 1;
    }
    throw err;
  }

  const report = evaluatePerfCheck(cells, aggregates, baseline, threshold);
  const command = reproCommand(specPath, baselinePath, threshold);
  console.log(formatPerfReport(report, command));

  const summaryPath = values['summary-file'] ?? process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath !== undefined && summaryPath !== '') {
    appendFileSync(summaryPath, formatPerfSummaryMarkdown(report, command));
  }

  return report.ok ? 0 : 1;
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}
