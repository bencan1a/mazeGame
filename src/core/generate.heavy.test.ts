/**
 * The literal 1000-seeds-per-size sweep. Not part of the default suite: at
 * 100x100 a board costs around 150ms, so 1000 of them is minutes rather than
 * seconds. Opt in with:
 *
 *   RUN_HEAVY_GENERATE_SWEEP=1 npx vitest run src/core/generate.heavy.test.ts
 *
 * It does not cap `maxAttempts`: doing so would measure a more lenient retry
 * budget than the one `generateBoard` ships with. The per-case timeout is
 * raised instead.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_GEN_PARAMS } from './types.js';
import { generateBoard, GenerationFailedError } from './generate.js';
import { checkStructure, greedyClear } from './validate/index.js';

const RUN = process.env.RUN_HEAVY_GENERATE_SWEEP === '1';
const SEED_COUNT = 1000;

const PIECE_REGIMES = [
  { label: 'default', meanPieceLength: 14, pieceLengthVariance: 5 },
  { label: 'reference-like', meanPieceLength: 5, pieceLengthVariance: 3 },
];

describe.skipIf(!RUN)('generateBoard heavy sweep: 1000 seeds per size', () => {
  it.each(
    [20, 40, 100].flatMap((gridSize) => PIECE_REGIMES.map((regime) => ({ gridSize, ...regime }))),
  )(
    'gridSize $gridSize, $label piece lengths',
    ({ gridSize, meanPieceLength, pieceLengthVariance }) => {
      let successes = 0;
      let failures = 0;
      for (let seed = 1; seed <= SEED_COUNT; seed++) {
        try {
          const board = generateBoard({
            ...DEFAULT_GEN_PARAMS,
            gridSize,
            seed,
            meanPieceLength,
            pieceLengthVariance,
          });
          expect(() => checkStructure(board)).not.toThrow();
          expect(greedyClear(board).stuck.length).toBe(0);
          successes++;
        } catch (err) {
          expect(err).toBeInstanceOf(GenerationFailedError);
          failures++;
        }
      }
      console.log(
        `gridSize ${gridSize} (${meanPieceLength}): ${successes}/${SEED_COUNT} seeds validated ` +
          `(${failures} exhausted every retry)`,
      );
      // The mask stage still declines on a minority of seeds and the retry
      // budget still has to clear those, so this is not vacuous.
      expect(failures).toBe(0);
    },
    // Generous next to the measured cost, so a slower machine does not read
    // as a hang.
    1_800_000,
  );
});
