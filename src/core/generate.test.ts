import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { assertDeterministic, checkStructure, greedyClear } from './validate/index.js';
import * as validateModule from './validate/index.js';
import * as pathModule from './path/index.js';
import * as segmentModule from './segment/index.js';
import { BoardInvariantError, DEFAULT_GEN_PARAMS } from './types.js';
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

function shortestSegment(board: ReturnType<typeof generateBoard>): number {
  let shortest = Infinity;
  for (let k = 0; k < board.segmentCount; k++) {
    shortest = Math.min(
      shortest,
      (board.segStart[k + 1] as number) - (board.segStart[k] as number),
    );
  }
  return shortest;
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

  describe('property tests', () => {
    const seedArb = fc.integer({ min: 0, max: 0xffffffff });
    const attemptArb = fc.integer({ min: 0, max: 50 });

    it('is a deterministic function of (seed, attempt), over arbitrary inputs', () => {
      fc.assert(
        fc.property(seedArb, attemptArb, (seed, attempt) => {
          expect(deriveAttemptSeed(seed, attempt)).toBe(deriveAttemptSeed(seed, attempt));
        }),
      );
    });

    it('gives distinct attempts of the same seed distinct internal seeds', () => {
      fc.assert(
        fc.property(seedArb, attemptArb, attemptArb, (seed, a, b) => {
          fc.pre(a !== b);
          expect(deriveAttemptSeed(seed, a)).not.toBe(deriveAttemptSeed(seed, b));
        }),
      );
    });

    it('gives distinct base seeds distinct internal seeds at the same attempt', () => {
      fc.assert(
        fc.property(attemptArb, seedArb, seedArb, (attempt, s1, s2) => {
          fc.pre(s1 !== s2);
          expect(deriveAttemptSeed(s1, attempt)).not.toBe(deriveAttemptSeed(s2, attempt));
        }),
      );
    });
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

  it('needs exactly 4 attempts for seed 34, pinning the attempt count itself', () => {
    // Distinct from the test above: `attempts: attempt + 1` mutated to
    // `attempt + 2` still satisfies "> 1" and "equal across two runs", so
    // this pins the exact value on a seed whose attempt count is known.
    const result = generateBoardWithDiagnostics(
      paramsAt({ gridSize: 20, fillFraction: 0.05, seed: 34 }),
    );
    expect(result.diagnostics.attempts).toBe(4);
  });
});

describe('generateBoard: the first internal attempt is enough at every size', () => {
  it.each([
    { gridSize: 20, seeds: 30 },
    { gridSize: 40, seeds: 100 },
    { gridSize: 100, seeds: 20 },
  ])(
    'gridSize $gridSize: $seeds consecutive seeds all succeed with no retry, at reference-like piece lengths',
    ({ gridSize, seeds }) => {
      const params = { meanPieceLength: 5, pieceLengthVariance: 3 };
      let successes = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const result = generateBoardWithDiagnostics(paramsAt({ ...params, gridSize, seed }), {
          maxAttempts: 1,
        });
        assertExternallySound(result.board);
        // The floor is a target the peel maintains rather than a guarantee, so
        // it is checked against what the peel says it achieved, not asserted
        // blind. At the default floor of 2 it has never had to give any up.
        expect(result.diagnostics.peel.belowMinimum).toBe(0);
        expect(shortestSegment(result.board)).toBeGreaterThanOrEqual(
          result.board.params.minPieceLength,
        );
        successes++;
      }
      expect(successes).toBe(seeds);
    },
    120_000,
  );
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
  it('validates by default when no options object is passed at all', () => {
    // Mutating the `validate` default to `false` leaves every other test in
    // this describe green, because they all pass `validate` explicitly.
    const spy = vi.spyOn(validateModule, 'validateBoard');
    spy.mockClear();

    generateBoardWithDiagnostics(paramsAt({ gridSize: 20, seed: 5 }));
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
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

  it('retries after validateBoard throws once, and the recovered attempt is genuinely sound', () => {
    // AC3 covers validation failure too, not only mask/orientation failure.
    // Without this, deleting the BoardInvariantError branch in generate.ts's
    // validation catch leaves every other test in this file green.
    const spy = vi.spyOn(validateModule, 'validateBoard').mockImplementationOnce(() => {
      throw new BoardInvariantError('forced failure to exercise the validation retry path');
    });

    const result = generateBoardWithDiagnostics(paramsAt({ gridSize: 20, seed: 5 }));
    expect(result.diagnostics.attempts).toBeGreaterThan(1);
    expect(result.diagnostics.attemptFailures[0]).toMatch(
      /^validation: forced failure to exercise/,
    );
    assertExternallySound(result.board);

    spy.mockRestore();
  });
});

describe('generateBoard: the cut-and-orient stage has no failure mode to classify', () => {
  it('never reports an attempt failure from segmentation across 40 seeds at gridSize 30', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const result = generateBoardWithDiagnostics(paramsAt({ gridSize: 30, seed }));
      expect(
        result.diagnostics.attemptFailures.filter((reason) => reason.startsWith('segment')),
      ).toEqual([]);
      assertExternallySound(result.board);
    }
    // Uninstrumented this runs in well under a second; v8 coverage pushes it
    // past vitest's 5s default.
  }, 30_000);

  it('a throw out of the cut-and-orient stage propagates instead of being retried', () => {
    // The stage models no refusal, so anything it throws is a fault. Catching
    // it broadly would retry it 8 times and surface it as an
    // indistinguishable GenerationFailedError instead of the real bug.
    const spy = vi.spyOn(segmentModule, 'peelSegments').mockImplementationOnce(() => {
      throw new Error('path cells 3 and 9 are not 4-neighbours (forced for this test)');
    });

    expect(() => generateBoard(paramsAt({ gridSize: 20, seed: 5 }))).toThrowError(
      /not 4-neighbours/,
    );

    spy.mockRestore();
  });
});

describe('generateBoard: path stage failure and fallback', () => {
  it('falls through to backbite when contour declines, and a real backbite success still validates', () => {
    // Without this, deleting the backbite fallback entirely (contour-only)
    // leaves every other test in this file green, because contour never
    // actually declines on real generated masks at the sizes exercised
    // elsewhere in this file.
    const contourSpy = vi.spyOn(pathModule, 'buildContourPath').mockReturnValue({
      ok: false,
      reason: 'forced decline to exercise the backbite fallback',
    });

    const result = generateBoardWithDiagnostics(paramsAt({ gridSize: 20, seed: 5 }));
    assertExternallySound(result.board);

    contourSpy.mockRestore();
  });

  it('reports a "path:" failure, retried, when both contour and backbite decline', () => {
    const contourSpy = vi.spyOn(pathModule, 'buildContourPath').mockReturnValue({
      ok: false,
      reason: 'forced contour decline for this test',
    });
    const backbiteSpy = vi.spyOn(pathModule, 'buildBackbitePath').mockReturnValue({
      ok: false,
      reason: 'forced backbite failure for this test',
    });

    let caught: unknown;
    try {
      generateBoard(paramsAt({ gridSize: 20, seed: 5 }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GenerationFailedError);
    const failure = (caught as GenerationFailedError).detail as { attemptFailures: string[] };
    expect(failure.attemptFailures).toHaveLength(DEFAULT_MAX_ATTEMPTS);
    expect(failure.attemptFailures.every((reason) => reason.startsWith('path:'))).toBe(true);

    contourSpy.mockRestore();
    backbiteSpy.mockRestore();
  });
});

describe('generateBoard: 40x40 and 100x100 either produce a valid board or fail loudly', () => {
  /**
   * These sizes are past a cliff in how often the contour path's segmentation
   * admits any acyclic orientation at all: at the default gridSize 40, well
   * under half of seeds succeed even with the full retry budget, and at
   * 100x100 essentially none do in a sample this small. So the success branch
   * below rarely runs here — the dedicated gridSize 40 test right after this
   * one pins a seed known to succeed, to check that a board that does escape
   * is genuinely sound at a size past the cliff, not only at 20x20. What this
   * test can be relied on to actually exercise is the failure branch: the
   * pipeline never throws anything other than the documented
   * `GenerationFailedError`.
   */
  it.each([40, 100])(
    'gridSize %i: every seed ends in a sound board or GenerationFailedError',
    (gridSize) => {
      let successes = 0;
      // Both kept small: this file already spends real time confirming
      // failures rather than successes at these sizes, and the full retry
      // budget is exercised elsewhere (the determinism, mask-repair-floor,
      // and dedicated gridSize 40 success tests all use the real default).
      const seedCount = 2;
      const maxAttempts = 2;
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
    // Coverage instrumentation measures at roughly 4x the uninstrumented cost
    // at gridSize 100 (measured ~8.5s here with seedCount/maxAttempts at 2);
    // 30s keeps comfortable margin without matching vitest's 5s default.
    30_000,
  );

  it('gridSize 40 seed 5 succeeds within the default retry budget and is genuinely sound', () => {
    const board = generateBoard(paramsAt({ gridSize: 40, seed: 5 }));
    assertExternallySound(board);
  });
});

describe('generateBoardWithDiagnostics: caller errors', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects maxAttempts %p up front', (maxAttempts) => {
    expect(() =>
      generateBoardWithDiagnostics(
        { ...DEFAULT_GEN_PARAMS, gridSize: 20, seed: 1 },
        { maxAttempts },
      ),
    ).toThrow(RangeError);
  });

  it('hands back a diagnostics array the caller cannot mutate into ours', () => {
    const result = generateBoardWithDiagnostics({ ...DEFAULT_GEN_PARAMS, gridSize: 20, seed: 1 });
    const before = result.diagnostics.attemptFailures.length;
    (result.diagnostics.attemptFailures as string[]).push('injected');
    const again = generateBoardWithDiagnostics({ ...DEFAULT_GEN_PARAMS, gridSize: 20, seed: 1 });
    expect(again.diagnostics.attemptFailures.length).toBe(before);
  });
});

describe('generateBoard: what the piece-length parameters actually deliver', () => {
  // meanPieceLength is the sampler's mean, and the floor truncates the
  // distribution's left tail, so the achieved mean sits above the requested
  // one by however much of the tail the floor cuts off. Nothing else in the
  // suite would notice that drifting.
  it.each([
    { meanPieceLength: 6, low: 6, high: 8.5 },
    { meanPieceLength: 14, low: 12.5, high: 15.5 },
  ])(
    'requesting $meanPieceLength cells lands between $low and $high',
    ({ meanPieceLength, low, high }) => {
      let segments = 0;
      let cells = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const board = generateBoard(paramsAt({ gridSize: 40, seed, meanPieceLength }));
        segments += board.segmentCount;
        cells += board.segStart[board.segmentCount] as number;
      }
      const achieved = cells / segments;
      expect(achieved).toBeGreaterThanOrEqual(low);
      expect(achieved).toBeLessThanOrEqual(high);
    },
    60_000,
  );

  it('reports the pieces it could not keep above the floor rather than hiding them', () => {
    // A floor well above what the free runs can offer near the end of a peel.
    // Generation still succeeds; the cost shows up in the diagnostics.
    let belowMinimum = 0;
    let shortest = Infinity;
    for (let seed = 1; seed <= 20; seed++) {
      const result = generateBoardWithDiagnostics(
        paramsAt({ gridSize: 40, seed, minPieceLength: 8, meanPieceLength: 10 }),
      );
      assertExternallySound(result.board);
      belowMinimum += result.diagnostics.peel.belowMinimum;
      shortest = Math.min(shortest, shortestSegment(result.board));
    }
    expect(belowMinimum).toBeGreaterThan(0);
    expect(shortest).toBeLessThan(8);
  }, 60_000);
});
