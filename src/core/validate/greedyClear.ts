/**
 * The topological sort over the declared blocking digraph (`edgeStart`/
 * `edgeTarget`) — Kahn's algorithm, i.e. exactly a simulated greedy clear: a
 * segment is free the moment every segment it depends on is gone.
 *
 * `validateBoard` uses this to check acyclicity and full reachability in one
 * pass. `dagDepth` and the free-set statistics in `BoardMetrics` (#15) fall out
 * of the same pass — the longest chain ending at a segment, and the size of
 * the free set at each removal, are both byproducts of this traversal, not a
 * second walk of the graph. `computeMetrics` should call this function
 * directly and read `depth`/`freeSetSizes` off the result rather than
 * re-deriving them.
 *
 * This function never throws: it is meant to be reusable by metrics on a
 * board that has not (yet, or ever) been through `validateBoard`, so it
 * reports what it finds — including an unsatisfiable board — as data rather
 * than an exception. `validateBoard` is what turns "stuck is non-empty" into a
 * thrown `BoardInvariantError` naming the segments.
 */

import type { Board, SegmentId } from '../types.js';

export interface GreedyClearResult {
  /** Segment ids in the order a greedy clear removes them. Shorter than n iff the digraph stalls. */
  readonly order: Uint32Array;
  /**
   * Longest dependency chain ending at each segment, indexed by `id - 1`. A
   * segment with no blockers has depth 1. 0 for a segment that never became
   * free (it has no well-defined finite depth).
   */
  readonly depth: Uint32Array;
  /** Size of the free (clickable) set immediately before each removal, same order as `order`. */
  readonly freeSetSizes: Uint32Array;
  /** Segment ids that never became free — non-empty iff the blocking digraph has a cycle (or a dangling edge). */
  readonly stuck: Uint32Array;
}

export function greedyClear(board: Board): GreedyClearResult {
  const n = board.segmentCount;
  // remaining[id-1] counts *all* declared blockers, including ones with an
  // out-of-range target id — an edge to nowhere can never be satisfied, so it
  // must still hold its dependent stuck rather than being silently skipped.
  const remaining = new Uint32Array(n);
  const blockedBy: SegmentId[][] = Array.from({ length: n + 1 }, () => []);

  for (let id = 1; id <= n; id++) {
    const from = board.edgeStart[id - 1] as number;
    const to = board.edgeStart[id] as number;
    remaining[id - 1] = to - from;
    for (let k = from; k < to; k++) {
      const target = board.edgeTarget[k] as number;
      if (target >= 1 && target <= n) (blockedBy[target] as SegmentId[]).push(id);
    }
  }

  const order = new Uint32Array(n);
  const depth = new Uint32Array(n);
  const freeSetSizes = new Uint32Array(n);
  const queue: SegmentId[] = [];
  for (let id = 1; id <= n; id++) if (remaining[id - 1] === 0) queue.push(id);

  let filled = 0;
  let head = 0;
  while (head < queue.length) {
    // Free-set size *before* this removal: everything already queued and not
    // yet processed. FIFO order does not change the size sequence, only which
    // same-round id is named first when several are free at once.
    freeSetSizes[filled] = queue.length - head;

    const id = queue[head] as SegmentId;
    head++;
    order[filled] = id;

    let maxBlockerDepth = 0;
    const from = board.edgeStart[id - 1] as number;
    const to = board.edgeStart[id] as number;
    for (let k = from; k < to; k++) {
      const target = board.edgeTarget[k] as number;
      if (target >= 1 && target <= n) {
        const blockerDepth = depth[target - 1] as number;
        if (blockerDepth > maxBlockerDepth) maxBlockerDepth = blockerDepth;
      }
    }
    depth[id - 1] = maxBlockerDepth + 1;
    filled++;

    for (const waiter of blockedBy[id] as SegmentId[]) {
      remaining[waiter - 1] = (remaining[waiter - 1] as number) - 1;
      if (remaining[waiter - 1] === 0) queue.push(waiter);
    }
  }

  const stuck: SegmentId[] = [];
  if (filled < n) {
    const cleared = new Set(order.subarray(0, filled));
    for (let id = 1; id <= n; id++) if (!cleared.has(id)) stuck.push(id);
  }

  return {
    order: order.subarray(0, filled),
    depth,
    freeSetSizes: freeSetSizes.subarray(0, filled),
    stuck: Uint32Array.from(stuck),
  };
}
