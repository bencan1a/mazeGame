import { describe, expect, it, vi } from 'vitest';
import { assertDeterministic, checkStructure, greedyClear } from './validate/index.js';
import * as validateModule from './validate/index.js';
import { DEFAULT_GEN_PARAMS } from './types.js';
import type { GenParams } from './types.js';
import {
  DEFAULT_MAX_ATTEMPTS,
  GenerationFailedError,
  deriveAttemptSeed,
  generateBoard,
  generateBoardWithDiagnostics,
} from './generate.js';

function paramsAt(overrides: Partial<GenParams>): GenParams {
  return { ...DEFAULT_GEN_PARAMS, ...overrides };
}

/** True regardless of mask access: a board that escaped generation must be structurally sound and solvable. */
function assertExternallySound(board: ReturnType<typeof generateBoard>): void {
  expect(() => checkStructure(board)).not.toThrow();
  expect(greedyClear(board).stuck.length).toBe(0);
}

describe('deriveAttemptSeed', () => {
  it('leaves attempt 0 as the seed unchanged', () => {
    expect(deriveAttemptSeed(12345, 0)).toBe(12345);
  });

  it('is a deterministic function of (seed, attempt)', () => {
    expect(deriveAttemptSeed(7, 3)).toBe(deriveAttemptSeed(7, 3));
  });

  it('gives different attempts of the same seed different internal seeds', () => {
    const seeds = new Set([1, 2, 3, 4, 5].map((attempt) => deriveAttemptSeed(99, attempt)));
    expect(seeds.size).toBe(5);
  });

  it('gives different base seeds different internal seeds at the same attempt', () => {
    expect(deriveAttemptSeed(1, 2)).not.toBe(deriveAttemptSeed(2, 2));
  });
});

describe('generateBoard determinism', () => {
  it('produces a byte-identical board across two calls with the same seed and params', () => {
    const params = paramsAt({ gridSize: 20, seed: 42 });
    const a = generateBoard(params);
    const b = generateBoard(params);
    expect(() => assertDeterministic(a, b)).not.toThrow();
  });

  it('produces a byte-identical board across two calls that both need a retry', () => {
    // seed 34 at this fillFraction hits the mask-repair floor on its first
    // internal attempt and recovers on a later one.
    const params = paramsAt({ gridSize: 20, fillFraction: 0.05, seed: 34 });
    const a = generateBoardWithDiagnostics(params);
    const b = generateBoardWithDiagnostics(params);
    expect(a.diagnostics.attempts).toBeGreaterThan(1);
    expect(a.diagnostics.attempts).toBe(b.diagnostics.attempts);
    expect(() => assertDeterministic(a.board, b.board)).not.toThrow();
  });
});

describe('generateBoard: 20x20 (a size clear of the mask-repair floor and the orientation cliff)', () => {
  it('succeeds and validates externally for every one of 30 consecutive seeds', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const board = generateBoard(paramsAt({ gridSize: 20, seed }));
      assertExternallySound(board);
    }
  });
});

describe('generateBoard: retry recovers from a mask-repair failure', () => {
  it('seed 1 at gridSize 20 / fillFraction 0.05 exhausts every attempt on mask repair alone', () => {
    const params = paramsAt({ gridSize: 20, fillFraction: 0.05, seed: 1 });
    let caught: unknown;
    try {
      generateBoard(params);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GenerationFailedError);
    const failure = caught as GenerationFailedError;
    const failures = (failure.detail as { attemptFailures: string[] }).attemptFailures;
    expect(failures).toHaveLength(DEFAULT_MAX_ATTEMPTS);
    expect(failures.every((reason) => reason.startsWith('mask:'))).toBe(true);
  });

  it('seed 34 at the same corner recovers after more than one internal attempt', () => {
    const params = paramsAt({ gridSize: 20, fillFraction: 0.05, seed: 34 });
    const result = generateBoardWithDiagnostics(params);
    expect(result.diagnostics.attempts).toBeGreaterThan(1);
    expect(result.diagnostics.attemptFailures[0]).toMatch(/^mask:/);
    assertExternallySound(result.board);
  });
});

describe('generateBoard: exhausting every attempt throws GenerationFailedError', () => {
  it('reports the attempt count and every per-attempt reason', () => {
    const params = paramsAt({ gridSize: 20, fillFraction: 0.05, seed: 1 });
    expect(() => generateBoardWithDiagnostics(params, { maxAttempts: 3 })).toThrow(
      GenerationFailedError,
    );
    try {
      generateBoardWithDiagnostics(params, { maxAttempts: 3 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GenerationFailedError);
      const failure = err as GenerationFailedError;
      expect(failure.message).toContain('exhausted 3 attempt(s)');
      const detail = failure.detail as { attemptFailures: string[] };
      expect(detail.attemptFailures).toHaveLength(3);
    }
  });
});

describe('generateBoard: validate option', () => {
  it('defaults to validating (an internally-inconsistent board is impossible to observe)', () => {
    const board = generateBoard(paramsAt({ gridSize: 20, seed: 5 }));
    assertExternallySound(board);
  });

  it('validate: false skips validateBoard but still returns a structurally assembled board', () => {
    const result = generateBoardWithDiagnostics(paramsAt({ gridSize: 20, seed: 5 }), {
      validate: false,
    });
    expect(() => checkStructure(result.board)).not.toThrow();
  });

  it('calls validateBoard exactly when validate is true, and not when it is false', () => {
    // checkStructure/greedyClear above hold by construction whenever
    // orientation succeeds, so they cannot tell the two options apart on
    // their own; this spies on the call directly instead.
    const spy = vi.spyOn(validateModule, 'validateBoard');
    spy.mockClear();

    generateBoardWithDiagnostics(paramsAt({ gridSize: 20, seed: 5 }), { validate: false });
    expect(spy).not.toHaveBeenCalled();

    generateBoardWithDiagnostics(paramsAt({ gridSize: 20, seed: 5 }), { validate: true });
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});

describe('generateBoard: retry recovers from an orientation that cannot be made acyclic', () => {
  // v8 coverage instrumentation slows this well past vitest's 5s default;
  // uninstrumented it runs in under 2s (see localSearch.convergence.test.ts
  // for the same tradeoff on a related check).
  const TIMEOUT_MS = 30_000;

  it(
    'gridSize 30 needs more than one attempt on several seeds, and diagnostics record why',
    () => {
      let sawMultiAttemptSuccess = false;
      let sawOrientationFailureReason = false;
      for (let seed = 1; seed <= 40; seed++) {
        const params = paramsAt({ gridSize: 30, seed });
        let result;
        try {
          result = generateBoardWithDiagnostics(params);
        } catch {
          continue;
        }
        if (result.diagnostics.attempts > 1) sawMultiAttemptSuccess = true;
        if (
          result.diagnostics.attemptFailures.some((reason) => reason.startsWith('orientation:'))
        ) {
          sawOrientationFailureReason = true;
        }
        assertExternallySound(result.board);
      }
      expect(sawMultiAttemptSuccess).toBe(true);
      expect(sawOrientationFailureReason).toBe(true);
    },
    TIMEOUT_MS,
  );
});

describe('generateBoard: 40x40 and 100x100 either produce a valid board or fail loudly', () => {
  /**
   * These sizes are past a cliff in how often the contour path's segmentation
   * admits any acyclic orientation at all: most seeds exhaust every retry.
   * This test does not assert success, because asserting something this
   * consistently false would be exactly the kind of test that cannot fail
   * honestly. What it does assert, and what has to remain true regardless of
   * how that upstream problem gets fixed, is that the pipeline never returns
   * an unsound board and never throws anything other than the documented
   * failure.
   */
  it.each([40, 100])(
    'gridSize %i: every seed ends in a sound board or GenerationFailedError',
    (gridSize) => {
      let successes = 0;
      const seedCount = 3;
      // A capped maxAttempts keeps this fast-tier check well under a second
      // per seed even at 100x100, where exhausting the full default budget
      // costs multiple seconds; the full default budget is exercised by the
      // determinism and mask-repair-floor tests above.
      const maxAttempts = 3;
      for (let seed = 1; seed <= seedCount; seed++) {
        try {
          const { board } = generateBoardWithDiagnostics(paramsAt({ gridSize, seed }), {
            maxAttempts,
          });
          assertExternallySound(board);
          successes++;
        } catch (err) {
          expect(err).toBeInstanceOf(GenerationFailedError);
        }
      }
      console.log(`gridSize ${gridSize}: ${successes}/${seedCount} seeds produced a valid board`);
    },
    // Coverage instrumentation roughly doubles the 100x100 orientation cost
    // measured elsewhere in this suite, and this covers a worst case where
    // every one of 3 seeds exhausts 3 attempts.
    30_000,
  );
});
