import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../rng.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { orientSegments } from './index.js';
import type { ReverseConstructOrienter, ReverseConstructResult } from './index.js';

/**
 * Two 2-cell segments end to end on a 4-wide, 1-tall strip: [0,1] then [2,3].
 * Segment 1's candidates are head=1 exiting East ("A") or head=0 exiting West
 * ("B", leaves the grid immediately). Segment 2's are head=3 exiting East
 * ("A", leaves the grid immediately) or head=2 exiting West ("B").
 *
 * Of the four (choice1, choice2) combinations exactly one is cyclic: A/B
 * (segment 1 exits East into segment 2, segment 2 exits West back into
 * segment 1). Every other combination is acyclic. `orientByLocalSearch`
 * draws its two initial candidate choices from `rng.int(2)` before touching
 * the graph at all, so seeding it to land on (or avoid) the one bad
 * combination is what makes both branches reachable deterministically,
 * rather than relying on the search itself failing to fix a graph this
 * small. Seeds re-derived for the current rng draw sequence if this ever
 * needs updating - see this file's git history for the small script used.
 */
const WIDTH = 4;
const HEIGHT = 1;
const SEGMENTS: SegmentedPath = {
  segStart: Uint32Array.from([0, 2, 4]),
  segCells: Uint32Array.from([0, 1, 2, 3]),
};
const OCCUPANCY = Uint16Array.from([1, 1, 2, 2]);
const CONVERGING_SEED = 1;
const NON_CONVERGING_SEED = 2;

describe('orientSegments: local search converges', () => {
  it('reports usedFallback: false and never calls the fallback', () => {
    const fallback = vi.fn<ReverseConstructOrienter>();
    const rng = createRng(CONVERGING_SEED);
    const result = orientSegments(SEGMENTS, OCCUPANCY, WIDTH, HEIGHT, rng, { fallback });

    expect(result.usedFallback).toBe(false);
    expect(result.localSearch.converged).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
    expect(result.segHead.length).toBe(2);
    expect(result.segDir.length).toBe(2);
    expect(result.segReversed.length).toBe(2);
  });
});

describe('orientSegments: local search does not converge inside its iteration box', () => {
  it('calls the injected fallback and reports usedFallback: true', () => {
    const stubResult: ReverseConstructResult = {
      ok: true,
      segHead: Uint32Array.from([1, 2]),
      segDir: Uint8Array.from([1, 3]),
      segReversed: Uint8Array.from([0, 1]),
      peelOrder: Uint32Array.from([2, 1]),
    };
    const fallback = vi.fn<ReverseConstructOrienter>(() => stubResult);
    const rng = createRng(NON_CONVERGING_SEED);

    const result = orientSegments(SEGMENTS, OCCUPANCY, WIDTH, HEIGHT, rng, {
      maxIterations: 0,
      fallback,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.localSearch.converged).toBe(false);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(SEGMENTS, OCCUPANCY, WIDTH, HEIGHT, rng);
    expect(Array.from(result.segHead)).toEqual(Array.from(stubResult.segHead));
    expect(Array.from(result.segDir)).toEqual(Array.from(stubResult.segDir));
    expect(Array.from(result.segReversed)).toEqual(Array.from(stubResult.segReversed));
  });

  it('fallback is required by the type system (AC #4: automatic, not opt-in), not merely documented', () => {
    const rng = createRng(NON_CONVERGING_SEED);
    expect(() =>
      // @ts-expect-error omitting `fallback` must fail to compile - that is what makes it impossible to forget.
      orientSegments(SEGMENTS, OCCUPANCY, WIDTH, HEIGHT, rng, { maxIterations: 0 }),
    ).toThrow(); // and, since JS ignores the type error, still fails loudly at runtime too
  });

  it('throws, naming issue #11, when the fallback itself reports it could not place every segment', () => {
    const stuckResult: ReverseConstructResult = { ok: false, stuck: Uint32Array.from([2]) };
    const fallback = vi.fn<ReverseConstructOrienter>(() => stuckResult);
    const rng = createRng(NON_CONVERGING_SEED);

    expect(() =>
      orientSegments(SEGMENTS, OCCUPANCY, WIDTH, HEIGHT, rng, { maxIterations: 0, fallback }),
    ).toThrow(/reverse construction \(issue #11\) could not place segment\(s\) 2/);
  });
});
