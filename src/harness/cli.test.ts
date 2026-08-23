import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.js';

interface JsonReportShape {
  rows: { metrics?: { generationMs: number } }[];
  aggregates: { generationMs: { mean: number; min: number; max: number } }[];
}

function stripTiming(text: string): JsonReportShape {
  const report = JSON.parse(text) as JsonReportShape;
  for (const row of report.rows) if (row.metrics) row.metrics.generationMs = 0;
  for (const agg of report.aggregates) agg.generationMs = { mean: 0, min: 0, max: 0 };
  return report;
}

let dir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-cli-test-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('main', () => {
  it('prints an aggregate summary and exits 0 when no output file is given', () => {
    const code = main(['--seeds', '2', '--grid', '20']);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('grid=20');
  });

  it('writes rows and aggregates as JSON to --json', () => {
    const out = join(dir, 'out.json');
    const code = main(['--seeds', '2', '--grid', '20', '--json', out]);
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8')) as {
      rows: unknown[];
      aggregates: unknown[];
    };
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.aggregates).toHaveLength(1);
  });

  it('writes a rows CSV and a sibling aggregates CSV to --csv', () => {
    const out = join(dir, 'out.csv');
    const code = main(['--seeds', '2', '--grid', '20', '--csv', out]);
    expect(code).toBe(0);
    const rows = readFileSync(out, 'utf8').trim().split('\n');
    expect(rows).toHaveLength(3);
    const agg = readFileSync(join(dir, 'out.agg.csv'), 'utf8').trim().split('\n');
    expect(agg).toHaveLength(2);
  });

  it('runs a --sweep grid, producing one cell per combination', () => {
    const specPath = join(dir, 'sweep.json');
    writeFileSync(
      specPath,
      JSON.stringify({ seeds: 2, params: { gridSize: [20, 24], fillFraction: 0.45 } }),
    );
    const out = join(dir, 'sweep-out.json');
    const code = main(['--sweep', specPath, '--json', out]);
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8')) as {
      rows: unknown[];
      aggregates: unknown[];
    };
    expect(parsed.aggregates).toHaveLength(2);
    expect(parsed.rows).toHaveLength(4);
  });

  it('is deterministic: the same invocation gives identical boards apart from measured timing', () => {
    const outA = join(dir, 'a.json');
    const outB = join(dir, 'b.json');
    main(['--seeds', '3', '--grid', '20', '--json', outA]);
    main(['--seeds', '3', '--grid', '20', '--json', outB]);
    expect(stripTiming(readFileSync(outA, 'utf8'))).toEqual(
      stripTiming(readFileSync(outB, 'utf8')),
    );
  });

  it('returns exit code 0 and prints --help without running a sweep', () => {
    const code = main(['--help']);
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Usage:');
  });

  it('returns a non-zero exit code and prints usage on a bad argument', () => {
    const code = main(['--seeds', 'nope']);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
