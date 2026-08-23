/**
 * Choose a head for every segment such that the blocking digraph is acyclic:
 * randomized local search first, reverse construction when its iteration box
 * expires.
 *
 * The fallback defaults to the real `reverseConstruct` and needs no wiring. It
 * stays injectable so a test can substitute a stub or force the stuck path,
 * but a caller who had to remember to supply it would be a thrown error
 * waiting to happen: local search rarely converges on measured geometry.
 */

import type { Rng } from '../rng.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
import type { LocalSearchStats } from './localSearch.js';
import { reverseConstruct } from './reverseConstruct.js';

export interface OrientationResult {
  readonly segHead: Uint32Array;
  readonly segDir: Uint8Array;
  /**
   * 1 = reverse this segment's `segCells` slice before writing it into
   * `Board.segCells`, so `segHead` ends up as the slice's last cell.
   * `segmentPath` emits one fixed order; the endpoint that is not already
   * last needs this.
   */
  readonly segReversed: Uint8Array;
}

/** Structurally `reverseConstruct`, kept a type so the seam stays injectable. */
export type ReverseConstructOrienter = typeof reverseConstruct;

export interface OrientSegmentsOptions {
  /** Overrides `DEFAULT_MAX_ITERATIONS`. */
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
   * produced the result instead. The caller plumbs this into
   * `BoardMetrics.orientationFallback`.
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
