/**
 * Placeholder. This file is a stand-in so the rest of the pipeline typechecks
 * and runs; swap it wholesale for the real implementation rather than
 * patching it. `coverage` and `bendRate` need the `Mask` and path order that
 * a `Board` alone does not carry, so both are constants here, not derived
 * values.
 */

import type { Board, BoardMetrics } from './types.js';
import { greedyClear } from './validate/index.js';

const PLACEHOLDER_COVERAGE = 1;
const PLACEHOLDER_BEND_RATE = 0;

export function computeMetrics(board: Board): BoardMetrics {
  const n = board.segmentCount;
  const clear = greedyClear(board);

  let dagDepth = 0;
  for (const d of clear.depth) if (d > dagDepth) dagDepth = d;

  let freeSetTotal = 0;
  for (const size of clear.freeSetSizes) freeSetTotal += size;
  const meanFreeSetSize =
    clear.freeSetSizes.length > 0 ? freeSetTotal / clear.freeSetSizes.length : 0;

  const minFreeSetSize = minBottleneckFreeSetSize(clear.freeSetSizes, n);

  return {
    segmentCount: n,
    coverage: PLACEHOLDER_COVERAGE,
    meanSegmentLength: n > 0 ? board.segCells.length / n : 0,
    bendRate: PLACEHOLDER_BEND_RATE,
    dagDepth,
    meanFreeSetSize,
    minFreeSetSize,
    edgeCount: board.edgeTarget.length,
    generationMs: 0,
  };
}

function minBottleneckFreeSetSize(freeSetSizes: Uint32Array, segmentCount: number): number {
  let min = Infinity;
  for (let i = 0; i < freeSetSizes.length; i++) {
    const remaining = segmentCount - i;
    const size = freeSetSizes[i] as number;
    if (size < remaining && size < min) min = size;
  }
  return Number.isFinite(min) ? min : segmentCount;
}
