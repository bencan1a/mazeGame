import { describe, expect, it } from 'vitest';
import { HarnessArgError, parseCliArgs } from './args.js';

describe('parseCliArgs', () => {
  it('defaults to single mode with seeds 20 and grid 40', () => {
    const args = parseCliArgs([]);
    expect(args.mode).toEqual({
      mode: 'single',
      seeds: 20,
      seedBase: 1,
      overrides: { gridSize: 40 },
    });
    expect(args.help).toBe(false);
  });

  it('reads --seeds and --grid into the single-mode overrides', () => {
    const args = parseCliArgs(['--seeds', '5', '--grid', '20']);
    expect(args.mode).toEqual({
      mode: 'single',
      seeds: 5,
      seedBase: 1,
      overrides: { gridSize: 20 },
    });
  });

  it('reads every GenParams override flag', () => {
    const args = parseCliArgs([
      '--grid',
      '30',
      '--mean',
      '7',
      '--variance',
      '3',
      '--fill',
      '0.5',
      '--min-piece-length',
      '3',
      '--min-straight-run',
      '4',
      '--bend-probability',
      '0.2',
    ]);
    expect(args.mode).toEqual({
      mode: 'single',
      seeds: 20,
      seedBase: 1,
      overrides: {
        gridSize: 30,
        meanPieceLength: 7,
        pieceLengthVariance: 3,
        fillFraction: 0.5,
        minPieceLength: 3,
        minStraightRun: 4,
        bendProbability: 0.2,
      },
    });
  });

  it('switches to sweep mode on --sweep and ignores single-mode flags', () => {
    const args = parseCliArgs(['--sweep', 'sweeps/x.json']);
    expect(args.mode).toEqual({ mode: 'sweep', specPath: 'sweeps/x.json' });
  });

  it('carries --json and --csv only when given', () => {
    const withOutputs = parseCliArgs(['--json', 'out.json', '--csv', 'out.csv']);
    expect(withOutputs.json).toBe('out.json');
    expect(withOutputs.csv).toBe('out.csv');

    const withoutOutputs = parseCliArgs([]);
    expect('json' in withoutOutputs).toBe(false);
    expect('csv' in withoutOutputs).toBe(false);
  });

  it('carries --max-attempts as a number, absent by default', () => {
    expect(parseCliArgs(['--max-attempts', '3']).maxAttempts).toBe(3);
    expect('maxAttempts' in parseCliArgs([])).toBe(false);
  });

  it('rejects a non-numeric --seeds', () => {
    expect(() => parseCliArgs(['--seeds', 'many'])).toThrow(HarnessArgError);
  });

  it('rejects zero or negative --seeds', () => {
    expect(() => parseCliArgs(['--seeds', '0'])).toThrow(HarnessArgError);
    expect(() => parseCliArgs(['--seeds', '-1'])).toThrow(HarnessArgError);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseCliArgs(['--not-a-flag', '1'])).toThrow(HarnessArgError);
  });

  it('reads --help', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });
});
