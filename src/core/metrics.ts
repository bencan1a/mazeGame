/**
 * Board metrics for the tuning harness.
 *
 * `dagDepth` and the free-set statistics are read off one greedy clear, rather
 * than walking the blocking digraph once per statistic. That clear is its own,
 * not the one `validateBoard` runs — a `Board` carries no record of an earlier
 * topological sort, so a caller that validates and then measures pays for two.
 */

import { directionBetween } from './grid.js';
import type { Board, BoardMetrics, HamiltonianPath, Mask } from './types.js';
import { BoardInvariantError } from './types.js';
import { greedyClear } from './validate/greedyClear.js';

/**
 * `coverage` is covered cells over *inside* cells, which only `Mask` carries
 * — a finished `Board` has no record of the silhouette it was cut from, only
 * of what ended up occupied. `generationMs` is wall-clock time around
 * `generateBoard`; `src/core` cannot read a clock itself (`Date.now` is a
 * lint error here), so the caller times the call and passes the reading in.
 */
export interface MetricsContext {
  /** The silhouette the board was cut from; `coverage` counts against its inside cells. */
  readonly mask: Mask;
  /** The walk the segments were cut from; `bendRate` counts corners along it. */
  readonly path: HamiltonianPath;
  /** Wall clock around `generateBoard`, timed by the caller. */
  readonly generationMs: number;
}

export function computeMetrics(board: Board, context: MetricsContext): BoardMetrics {
  const { mask, path, generationMs } = context;
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
    bendRate: bendRateOf(path, board.width),
    dagDepth,
    meanFreeSetSize: n > 0 ? freeSetTotal / n : 0,
    minFreeSetSize,
    edgeCount: board.edgeTarget.length,
    generationMs,
  };
}

function coverageOf(board: Board, mask: Mask): number {
  if (board.width !== mask.width || board.height !== mask.height) {
    throw new BoardInvariantError(
      `board is ${board.width}x${board.height}, mask is ${mask.width}x${mask.height}`,
      {
        board: { width: board.width, height: board.height },
        mask: { width: mask.width, height: mask.height },
      },
    );
  }
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
 * Corners over interior cells, along the walk itself rather than per segment,
 * and per region: the two cells either side of a region boundary are the ends
 * of two separate walks, not a turn.
 */
function bendRateOf(path: HamiltonianPath, width: number): number {
  const { cells, regionStart } = path;
  let corners = 0;
  let interior = 0;
  for (let r = 0; r + 1 < regionStart.length; r++) {
    const from = regionStart[r] as number;
    const to = regionStart[r + 1] as number;
    if (to - from < 3) continue;
    interior += to - from - 2;
    for (let i = from + 1; i + 1 < to; i++) {
      const dirIn = directionBetween(cells[i - 1] as number, cells[i] as number, width);
      const dirOut = directionBetween(cells[i] as number, cells[i + 1] as number, width);
      if (dirIn !== dirOut) corners++;
    }
  }
  return interior > 0 ? corners / interior : 0;
}
