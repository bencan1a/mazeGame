/**
 * Choose a head for every segment such that the blocking digraph is acyclic:
 * randomized local search first, reverse construction when its iteration box
 * expires. The fallback is injected rather than imported so this module can be
 * tested against a stub.
 */

import type { Rng } from '../rng.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { DEFAULT_MAX_ITERATIONS, orientByLocalSearch } from './localSearch.js';
import type { reverseConstruct } from './reverseConstruct.js';
import type { LocalSearchStats } from './localSearch.js';

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

/** The result shape `reverseConstruct` produces. */
export type { ReverseConstructResult } from './reverseConstruct.js';

/** Structurally `reverseConstruct`, kept a type so the seam stays injected. */
export type ReverseConstructOrienter = typeof reverseConstruct;

export interface OrientSegmentsOptions {
  /** Overrides `DEFAULT_MAX_ITERATIONS`. */
  readonly maxIterations?: number;
  /**
   * Required, not optional: local search fails to converge often enough on
   * real geometry that a forgotten injection would throw out of the generator
   * rather than being a rare edge case. A caller that wants to see local
   * search's raw failure passes a stub that reports `{ ok: false }`.
   */
  readonly fallback: ReverseConstructOrienter;
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
  options: OrientSegmentsOptions,
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
