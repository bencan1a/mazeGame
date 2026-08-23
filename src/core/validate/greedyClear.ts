/**
 * The topological sort over the declared blocking digraph (`edgeStart`/
 * `edgeTarget`) — Kahn's algorithm, i.e. exactly a simulated greedy clear: a
 * segment is free the moment every segment it depends on is gone.
 *
 * Never throws: an unsatisfiable board comes back as a non-empty `stuck`, so
 * this can also run on a board that has not been validated.
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
  // Counts *all* declared blockers, out-of-range target ids included: an edge
  // to nowhere can never be satisfied, so it must hold its dependent stuck.
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
    // Free-set size *before* this removal: everything queued and not yet
    // processed. FIFO order does not change the sequence of sizes, only which
    // same-round id is named first.
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
