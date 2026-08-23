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
 * Reverse construction is the default fallback and needs no wiring by the
 * caller. It stays injectable through `options.fallback` so a test can
 * substitute a stub or force the stuck path, but the default is the real one:
 * on measured board geometry local search rarely converges, so a caller that
 * had to remember to supply it would be a thrown error waiting to happen.
 */

import type { Rng } from '../rng.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
import type { LocalSearchStats } from './localSearch.js';
import { reverseConstruct } from './reverseConstruct.js';
import type { ReverseConstructResult } from './reverseConstruct.js';

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

/** Same argument order as `orientSegments` itself, minus the options bag - reverse construction has no iteration box to configure. */
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
   * Defaults to `reverseConstruct`. Override only to substitute a stub or to
   * force the stuck path in a test - production callers should not pass this.
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

  const fallback = (options.fallback ?? reverseConstruct)(segments, occupancy, width, height, rng);
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
export { reverseConstruct } from './reverseConstruct.js';
export type {
  ReverseConstructResult,
  ReverseConstructSuccess,
  ReverseConstructFailure,
} from './reverseConstruct.js';
export { buildBlockingGraph } from './blocking.js';
export type { BlockingGraph, BlockingGraphInput } from './blocking.js';
