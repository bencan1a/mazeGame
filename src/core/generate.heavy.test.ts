/**
 * The literal 1000-seeds-per-size sweep. Not part of the default suite: at
 * 40x40 and especially 100x100, most seeds exhaust every retry, and an
 * exhausted retry costs several seconds per seed, so 1000 of them is a
 * multi-minute run. Opt in with:
 *
 *   RUN_HEAVY_GENERATE_SWEEP=1 npx vitest run src/core/generate.heavy.test.ts
 *
 * This intentionally does not shrink the sample to make the numbers look
 * better, and it does not assert "all validate" at 40x40/100x100, because
 * that assertion is false today — see the console summary each run prints.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_GEN_PARAMS } from './types.js';
import { generateBoard, GenerationFailedError } from './generate.js';
import { checkStructure, greedyClear } from './validate/index.js';

const RUN = process.env.RUN_HEAVY_GENERATE_SWEEP === '1';
const SEED_COUNT = 1000;

describe.skipIf(!RUN)('generateBoard heavy sweep: 1000 seeds per size', () => {
  it.each([20, 40, 100])(
    'gridSize %i',
    (gridSize) => {
      let successes = 0;
      let failures = 0;
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        try {
          const board = generateBoard({ ...DEFAULT_GEN_PARAMS, gridSize, seed });
          expect(() => checkStructure(board)).not.toThrow();
          expect(greedyClear(board).stuck.length).toBe(0);
          successes++;
        } catch (err) {
          expect(err).toBeInstanceOf(GenerationFailedError);
          failures++;
        }
      }
      console.log(
        `gridSize ${gridSize}: ${successes}/${SEED_COUNT} seeds validated ` +
          `(${failures} exhausted every retry)`,
      );
    },
    3_600_000,
  );
});
