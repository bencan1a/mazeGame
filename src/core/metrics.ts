/**
 * Board metrics for the tuning harness.
 *
 * `dagDepth` and the free-set statistics are read off the greedy-clear result
 * that a topological sort of the blocking digraph already produces, rather
 * than walking that digraph a second time.
 */

import { directionBetween } from './grid.js';
import type { Board, BoardMetrics, Mask } from './types.js';
import { BoardInvariantError } from './types.js';
import { greedyClear } from './validate/greedyClear.js';

/**
 * `coverage` is covered cells over *inside* cells, which only `Mask` carries
 * — a finished `Board` has no record of the silhouette it was cut from, only
 * of what ended up occupied. `generationMs` is wall-clock time around
 * `generateBoard`; `src/core` cannot read a clock itself (`Date.now` is a
 * lint error here), so the caller times the call and passes the reading in.
 */
export function computeMetrics(board: Board, mask: Mask, generationMs: number): BoardMetrics {
  const n = board.segmentCount;
  const clear = greedyClear(board);
  if (clear.stuck.length > 0) {
    throw new BoardInvariantError(
      `computeMetrics: board is unsolvable, ${clear.stuck.length} of ${n} segments never ` +
        `become free in a greedy clear (${Array.from(clear.stuck).join(', ')}); metrics are ` +
        `undefined for a board that has not passed validateBoard`,
      { stuck: Array.from(clear.stuck) },
    );
  }

  let dagDepth = 0;
  for (let idx = 0; idx < n; idx++) {
    const depth = clear.depth[idx] as number;
    if (depth > dagDepth) dagDepth = depth;
  }

  // `freeSetSizes[step]` is the free-set size immediately before that step's
  // removal; `n - step` is how many segments were still uncleared at that
  // point, so their difference is how many were uncleared and *not* free.
  // Endgame steps — where nothing was left to block — carry zero here and are
  // excluded from the minimum, per the definition in the board metrics docs.
  let freeSetTotal = 0;
  let minFreeSetSize = n;
  for (let step = 0; step < n; step++) {
    const freeSize = clear.freeSetSizes[step] as number;
    freeSetTotal += freeSize;
    const uncleared = n - step;
    const blocked = uncleared - freeSize;
    if (blocked > 0 && freeSize < minFreeSetSize) minFreeSetSize = freeSize;
  }

  return {
    segmentCount: n,
    coverage: coverageOf(board, mask),
    meanSegmentLength: n > 0 ? board.segCells.length / n : 0,
    bendRate: bendRateOf(board),
    dagDepth,
    meanFreeSetSize: n > 0 ? freeSetTotal / n : 0,
    minFreeSetSize,
    edgeCount: board.edgeTarget.length,
    generationMs,
  };
}

function coverageOf(board: Board, mask: Mask): number {
  const size = board.width * board.height;
  let insideCount = 0;
  let coveredCount = 0;
  for (let cell = 0; cell < size; cell++) {
    if (mask.inside[cell] === 1) insideCount++;
    if ((board.occupancy[cell] as number) !== 0) coveredCount++;
  }
  return insideCount > 0 ? coveredCount / insideCount : 0;
}

/**
 * A segment's tail and head are where the original Hamiltonian path
 * continues into whichever segment was cut next to it, and a `Board` does
 * not record that path adjacency — only the geometry within each segment
 * survives. So "interior" here is interior to a *segment*: cells with both
 * neighbours inside that same segment's own run. A one- or two-cell segment
 * has none.
 */
function bendRateOf(board: Board): number {
  let interior = 0;
  let corners = 0;
  for (let id = 1; id <= board.segmentCount; id++) {
    const from = board.segStart[id - 1] as number;
    const to = board.segStart[id] as number;
    for (let k = from + 1; k < to - 1; k++) {
      const prev = board.segCells[k - 1] as number;
      const cur = board.segCells[k] as number;
      const next = board.segCells[k + 1] as number;
      const dirIn = directionBetween(prev, cur, board.width);
      const dirOut = directionBetween(cur, next, board.width);
      interior++;
      if (dirIn !== dirOut) corners++;
    }
  }
  return interior > 0 ? corners / interior : 0;
}
