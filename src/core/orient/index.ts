/**
 * Orientation entry point (issue #10, docs/CONTRACTS.md "orientation"):
 * choose a head for every segment such that the resulting blocking digraph is
 * acyclic.
 *
 * Two implementations, per docs/CONTRACTS.md:
 *   1. Randomized local search (localSearch.ts) - the default, tried first.
 *   2. Reverse construction (issue #11, `reverseConstruct.ts`) - correct by
 *      construction, the mandated fallback when local search's iteration box
 *      expires (R2, docs/PLAN.md).
 *
 * #11 is landing in parallel on its own branch and does not own this file, so
 * the fallback is an injected dependency (`options.fallback`) rather than an
 * import: this module is fully testable today against a stub, and wiring the
 * real implementation in later is a one-line change at the call site (see
 * `ReverseConstructOrienter` below for the exact shape #11 must match).
 */

import type { Rng } from '../rng.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
import type { LocalSearchStats } from './localSearch.js';

export interface OrientationResult {
  readonly segHead: Uint32Array;
  readonly segDir: Uint8Array;
  /**
   * 1 = the caller must reverse this segment's `segCells` slice before
   * writing it into `Board.segCells`, so `segHead` ends up as the slice's
   * *last* cell - the invariant `src/core/validate/structure.ts` enforces.
   * `segmentPath` hands every segment's cells in one fixed (path-visit)
   * order; whichever endpoint is *not* already last needs this.
   */
  readonly segReversed: Uint8Array;
}

/** Reverse construction succeeded: every segment got a head. */
export interface ReverseConstructOk extends OrientationResult {
  readonly ok: true;
  /** The order segments were slid in from the edge, reversed by construction gives a valid removal order. */
  readonly peelOrder: Uint32Array;
}
// `ReverseConstructOk`'s `segReversed` comes from `OrientationResult` above,
// so both orienters report it under the same name and shape.

/** Reverse construction could not place every segment (geometry-dependent; see #11). */
export interface ReverseConstructStuck {
  readonly ok: false;
  readonly stuck: Uint32Array;
}

export type ReverseConstructResult = ReverseConstructOk | ReverseConstructStuck;

/**
 * The shape issue #11's `reverseConstruct` exports (`src/core/orient/reverseConstruct.ts`,
 * not on this branch). Same argument order as `orientSegments` itself, minus
 * the options bag - reverse construction has no iteration box to configure.
 */
export type ReverseConstructOrienter = (
  segments: Pick<SegmentedPath, 'segStart' | 'segCells'>,
  occupancy: Uint16Array,
  width: number,
  height: number,
  rng: Rng,
) => ReverseConstructResult;

export interface OrientSegmentsOptions {
  /** Overrides `localSearch.ts`'s `DEFAULT_MAX_ITERATIONS`. */
  readonly maxIterations?: number;
  /**
   * Reverse construction, injected. Required for a board that local search
   * might fail to converge on; omitting it is only safe when the caller is
   * prepared for `orientSegments` to throw on non-convergence (tests, or a
   * caller that wants to observe the failure itself).
   */
  readonly fallback?: ReverseConstructOrienter;
}

export interface OrientSegmentsResult extends OrientationResult {
  /**
   * True when local search's iteration box expired and reverse construction
   * produced the result instead. AC #4 asks this be "recorded in metrics";
   * `BoardMetrics` (src/core/types.ts) is a shared contract file this stream
   * cannot edit unilaterally, so this flag is returned here for the caller
   * (generate.ts, once it exists) to plumb into a new metrics field behind
   * its own contract-change issue. See this issue's report for the exact
   * field this needs.
   */
  readonly usedFallback: boolean;
  readonly localSearch: LocalSearchStats;
}

export function orientSegments(
  segments: SegmentedPath,
  occupancy: Uint16Array,
  width: number,
  height: number,
  rng: Rng,
  options: OrientSegmentsOptions = {},
): OrientSegmentsResult {
  const searched = orientByLocalSearch(segments, occupancy, width, height, rng, {
    maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  });
  const localSearch: LocalSearchStats = {
    converged: searched.converged,
    iterations: searched.iterations,
    flips: searched.flips,
    initialSccCount: searched.initialSccCount,
    finalSccCount: searched.finalSccCount,
  };

  if (searched.converged) {
    return {
      segHead: searched.segHead,
      segDir: searched.segDir,
      segReversed: searched.segReversed,
      usedFallback: false,
      localSearch,
    };
  }

  if (options.fallback === undefined) {
    throw new Error(
      `orientSegments: local search did not reach an acyclic assignment within ` +
        `${String(searched.iterations)} iterations, and no fallback orienter was supplied. ` +
        'Reverse construction (issue #11) is the designated fallback - pass it as options.fallback.',
    );
  }

  const fallback = options.fallback(segments, occupancy, width, height, rng);
  if (!fallback.ok) {
    throw new Error(
      `orientSegments: local search did not converge, and reverse construction (issue #11) could ` +
        `not place segment(s) ${Array.from(fallback.stuck).join(', ')} either. There is no further fallback.`,
    );
  }
  return {
    segHead: fallback.segHead,
    segDir: fallback.segDir,
    segReversed: fallback.segReversed,
    usedFallback: true,
    localSearch,
  };
}

export { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
export { assembleSegCells } from './assembleSegCells.js';
export type { LocalSearchOptions, LocalSearchResult, LocalSearchStats } from './localSearch.js';
export { computeHeadCandidates } from './headOptions.js';
export type { HeadCandidates } from './headOptions.js';
export { occupancyFromSegments } from './occupancy.js';
export { tarjanSCC, cyclicNodes, countCyclicComponents } from './tarjan.js';
export type { CsrGraph, TarjanResult } from './tarjan.js';
export { buildBlockingGraph } from './blocking.js';
export type { BlockingGraph, BlockingGraphInput } from './blocking.js';
