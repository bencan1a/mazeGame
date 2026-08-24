import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCellParams } from './paramGrid.js';
import { main } from './perfCheckCli.js';
import type { Clock } from './run.js';

/** Every board reports the same elapsed time, so a baseline recorded here and compared here never trips on real generation-time noise at a tiny grid size. */
function fakeClock(deltaMs: number): Clock {
  let t = 0;
  return {
    now: () => {
      const value = t;
      t += deltaMs;
      return value;
    },
  };
}

let dir: string;
let specPath: string;
let baselinePath: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

// Small grid sizes so the suite runs in milliseconds; the committed spec
// pointed at 40/100 is exercised separately, by hand, when the baseline is
// recorded.
const TINY_SPEC = { seeds: 2, seedBase: 1, params: { gridSize: [12, 16] } };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perf-check-cli-test-'));
  specPath = join(dir, 'spec.json');
  baselinePath = join(dir, 'baseline.json');
  writeFileSync(specPath, JSON.stringify(TINY_SPEC));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function printed(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => String(c[0])).join('\n');
}

describe('main --update-baseline', () => {
  it('writes a baseline with one entry per gridSize', () => {
    const code = main(['--spec', specPath, '--baseline', baselinePath, '--update-baseline']);
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      cells: { gridSize: number }[];
    };
    expect(written.cells.map((c) => c.gridSize)).toEqual([12, 16]);
  });
});

describe('main: comparison against a freshly recorded baseline', () => {
  it('passes when the baseline was recorded from an identical spec', () => {
    const args = ['--spec', specPath, '--baseline', baselinePath];
    expect(main([...args, '--update-baseline'], { clock: fakeClock(10) })).toBe(0);
    const code = main(args, { clock: fakeClock(10) });
    expect(code).toBe(0);
    expect(printed(logSpy)).toMatch(/not a device measurement/);
  });

  it('fails loudly, naming gridSize and seeds, when the baseline is far below the real run', () => {
    // Recorded from the same spec, then driven to a floor: a hand-written
    // baseline would miss the params the comparison now checks.
    expect(main(['--spec', specPath, '--baseline', baselinePath, '--update-baseline'])).toBe(0);
    const recorded = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      cells: { meanMs: number; maxMs: number }[];
    };
    for (const cell of recorded.cells) {
      cell.meanMs = 0.0001;
      cell.maxMs = 0.0001;
    }
    writeFileSync(baselinePath, JSON.stringify(recorded));
    const code = main(['--spec', specPath, '--baseline', baselinePath]);
    expect(code).toBe(1);
    const out = printed(logSpy);
    expect(out).toContain('gridSize=12');
    expect(out).toContain('REGRESSED');
    expect(out).toContain('seeds=');
    expect(out).toContain('Reproduce locally:');
  });

  it('writes a markdown summary to --summary-file', () => {
    const args = ['--spec', specPath, '--baseline', baselinePath];
    expect(main([...args, '--update-baseline'], { clock: fakeClock(10) })).toBe(0);
    const summaryPath = join(dir, 'summary.md');
    const code = main([...args, '--summary-file', summaryPath], { clock: fakeClock(10) });
    expect(code).toBe(0);
    expect(readFileSync(summaryPath, 'utf8')).toContain('Generation-time regression check');
  });
});

describe('main: cannot pass vacuously', () => {
  it('fails when the baseline file is missing rather than skipping the check', () => {
    const code = main(['--spec', specPath, '--baseline', join(dir, 'absent.json')]);
    expect(code).toBe(1);
    expect(printed(errorSpy)).toMatch(/cannot read baseline/);
  });

  it('fails when the baseline is malformed JSON', () => {
    writeFileSync(baselinePath, '{ not json');
    const code = main(['--spec', specPath, '--baseline', baselinePath]);
    expect(code).toBe(1);
    expect(printed(errorSpy)).toMatch(/not valid JSON/);
  });

  it('fails when the sweep spec is missing', () => {
    const code = main(['--spec', join(dir, 'absent-spec.json'), '--baseline', baselinePath]);
    expect(code).toBe(1);
    expect(printed(errorSpy)).toMatch(/cannot read sweep spec/);
  });

  it('fails rather than silently comparing nothing when every board fails to generate', () => {
    // gridSize 1 cannot pass mask repair — every attempt fails deterministically.
    writeFileSync(specPath, JSON.stringify({ seeds: 2, params: { gridSize: [1] } }));
    writeFileSync(
      baselinePath,
      JSON.stringify({
        cells: [
          {
            gridSize: 1,
            seedCount: 2,
            params: { ...defaultCellParams(), gridSize: 1 },
            meanMs: 5,
            maxMs: 5,
          },
        ],
      }),
    );
    const code = main(['--spec', specPath, '--baseline', baselinePath]);
    expect(code).toBe(1);
    expect(printed(logSpy)).toMatch(/BROKEN/);
  });

  it('refuses a threshold of 1 or less, which would flag ordinary noise as a regression', () => {
    const code = main(['--spec', specPath, '--baseline', baselinePath, '--threshold', '1']);
    expect(code).toBe(1);
    expect(printed(errorSpy)).toMatch(/--threshold must be/);
  });
});

describe('main --help', () => {
  it('prints usage and exits 0 without running anything', () => {
    const code = main(['--help']);
    expect(code).toBe(0);
    expect(printed(logSpy)).toContain('Usage:');
  });
});
