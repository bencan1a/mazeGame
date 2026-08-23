/**
 * The literal 1000-seeds-per-size sweep. Not part of the default suite: at
 * 40x40 and especially 100x100, most seeds exhaust every retry, and an
 * exhausted retry measures around 4.2s/seed at 100x100 (8 attempts against
 * the production default), so 1000 of them is over an hour. Opt in with:
 *
 *   RUN_HEAVY_GENERATE_SWEEP=1 npx vitest run src/core/generate.heavy.test.ts
 *
 * This intentionally does not shrink the sample to make the numbers look
 * better, and it does not assert "all validate" at 40x40/100x100, because
 * that assertion is false today — see the console summary each run prints.
 * It also does not cap `maxAttempts` to make the sweep finish faster: doing
 * so would measure a different, more lenient retry budget than the one
 * `generateBoard` actually ships with, defeating the point of an AC5 check
 * against the production default. The per-case timeout is raised instead.
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
    // 1000 seeds x ~4.2s/seed measured at 100x100 is ~70 minutes; two hours
    // leaves headroom for a slower machine without masking a genuine hang.
    7_200_000,
  );
});
