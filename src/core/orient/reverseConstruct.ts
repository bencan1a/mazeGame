/**
 * The orientation fallback for when local search does not converge.
 *
 * Segmentation has already fixed which cells each segment owns, so
 * orientation's only freedom is which endpoint is the head, with `segDir`
 * following from the terminal stroke there.
 *
 * A greedy peel: repeatedly take a still-present segment with a candidate
 * whose exit ray is clear of every other still-present segment, fix that
 * candidate, remove it. A segment peeled at step t depended only on segments
 * peeled before t, so the result has no cycle to find.
 *
 * A candidate's blocker set is fixed geometry — cells never move, only
 * presence does — so it is computed once against the untouched `occupancy`,
 * and peeling decrements a count of not-yet-peeled blockers rather than
 * rescanning what is left.
 *
 * The peel is complete over that candidate set: `ok: false` means no acyclic
 * orientation exists for this segmentation at all, so the recovery is
 * re-segmenting or re-pathing, not retrying orientation.
 */

import { NO_CELL, directionBetween, step } from '../grid.js';
import type { Rng } from '../rng.js';
import type { Direction } from '../types.js';
import type { SegmentedPath } from '../segment/segmentPath.js';

export interface ReverseConstructSuccess {
  readonly ok: true;
  /** Head cell index per segment. Length n. */
  readonly segHead: Uint32Array;
  /** Exit direction per segment. Length n. */
  readonly segDir: Uint8Array;
  /**
   * Authoritative. 1 means segment k's cells must be emitted in reverse of the
   * segmenter's order, so `segHead` ends up as the slice's last cell.
   * `segCells` below is derived from this, not a second source of truth.
   */
  readonly segReversed: Uint8Array;
  /**
   * Cells per segment, CSR-aligned with the input `segStart`, with
   * `segReversed` already applied. Use this or the flag, never both —
   * reversing an already-reversed slice silently un-reverses it.
   */
  readonly segCells: Uint32Array;
  /**
   * Segment ids in the order the peel removed them: every blocker appears
   * before the segments it blocks. Reversed, it is a topological order of the
   * blocking digraph in the usual source-before-target sense.
   */
  readonly peelOrder: Uint32Array;
}

export interface ReverseConstructFailure {
  readonly ok: false;
  /**
   * Segment ids that never had a candidate whose ray cleared. Not a normal
   * outcome to route around silently — see the module comment on what it
   * means.
   */
  readonly stuck: Uint32Array;
}

export type ReverseConstructResult = ReverseConstructSuccess | ReverseConstructFailure;

/**
 * `occupancy` is cell -> segment id, 0 empty — fixed by segmentation and
 * independent of any orientation choice.
 */
export function reverseConstruct(
  segments: Pick<SegmentedPath, 'segStart' | 'segCells'>,
  occupancy: Uint16Array,
  width: number,
  height: number,
  rng: Rng,
): ReverseConstructResult {
  const { segStart, segCells } = segments;
  const n = segStart.length - 1;

  if (n === 0) {
    return {
      ok: true,
      segHead: new Uint32Array(0),
      segDir: new Uint8Array(0),
      segReversed: new Uint8Array(0),
      segCells: new Uint32Array(0),
      peelOrder: new Uint32Array(0),
    };
  }

  const { candHead, candDir, candSeg, candReversed } = buildCandidates(segStart, segCells, width);
  const candidateCount = candHead.length;

  // remaining[c] counts distinct still-present blockers for candidate c;
  // waitingOn[id] lists every candidate blocked (in part) on segment id, so
  // peeling id can decrement exactly the candidates that care.
  const remaining = new Int32Array(candidateCount);
  const waitingOn: number[][] = Array.from({ length: n + 1 }, () => []);

  for (let c = 0; c < candidateCount; c++) {
    const dir = candDir[c] as Direction;
    const ownId = candSeg[c] as number;
    const seen = new Set<number>();
    let cell = step(candHead[c] as number, dir, width, height);
    while (cell !== NO_CELL) {
      const other = occupancy[cell] as number;
      // Own cells never block (however many times a bent segment's own ray
      // crosses them); a blocker already seen on this ray adds no further
      // dependency, matching buildBlockingGraph's one-edge-per-pair rule.
      if (other !== 0 && other !== ownId && !seen.has(other)) {
        seen.add(other);
        (waitingOn[other] as number[]).push(c);
      }
      cell = step(cell, dir, width, height);
    }
    remaining[c] = seen.size;
  }

  const resolved = new Uint8Array(n);
  const segReversed = new Uint8Array(n);
  const segHead = new Uint32Array(n);
  const segDir = new Uint8Array(n);
  const peelOrder = new Uint32Array(n);
  let filled = 0;

  // Which candidate is picked when several qualify is an explicit seeded
  // choice, not incidental to iteration order. Swap-removal keeps it O(1).
  const ready: number[] = [];
  for (let c = 0; c < candidateCount; c++) if (remaining[c] === 0) ready.push(c);

  while (ready.length > 0) {
    const pick = rng.int(ready.length);
    const last = ready.length - 1;
    const c = ready[pick] as number;
    ready[pick] = ready[last] as number;
    ready.pop();

    const id = candSeg[c] as number;
    if (resolved[id - 1] === 1) continue; // already peeled via its other candidate

    resolved[id - 1] = 1;
    segHead[id - 1] = candHead[c] as number;
    segDir[id - 1] = candDir[c] as number;
    segReversed[id - 1] = candReversed[c] as number;
    peelOrder[filled++] = id;

    for (const waiter of waitingOn[id] as number[]) {
      const left = (remaining[waiter] as number) - 1;
      remaining[waiter] = left;
      if (left === 0) ready.push(waiter);
    }
  }

  if (filled < n) {
    const stuck: number[] = [];
    for (let id = 1; id <= n; id++) if (resolved[id - 1] === 0) stuck.push(id);
    return { ok: false, stuck: Uint32Array.from(stuck) };
  }

  const outCells = new Uint32Array(segCells.length);
  for (let id = 1; id <= n; id++) {
    const from = segStart[id - 1] as number;
    const to = segStart[id] as number;
    if (segReversed[id - 1] === 1) {
      for (let k = from; k < to; k++) outCells[k] = segCells[to - 1 - (k - from)] as number;
    } else {
      for (let k = from; k < to; k++) outCells[k] = segCells[k] as number;
    }
  }

  return { ok: true, segHead, segDir, segReversed, segCells: outCells, peelOrder };
}

interface Candidates {
  readonly candHead: Uint32Array;
  readonly candDir: Uint8Array;
  /** Owning segment id (1-based) per candidate. */
  readonly candSeg: Uint32Array;
  /** 1 if choosing this candidate means the segment's cells must be emitted in reverse of `segCells`'s input order. */
  readonly candReversed: Uint8Array;
}

/**
 * Two candidates per segment — its two endpoints, each paired with its own
 * terminal stroke — or four for a single-cell segment, which has no terminal
 * stroke and so is unconstrained in all of N/E/S/W.
 */
function buildCandidates(segStart: Uint32Array, segCells: Uint32Array, width: number): Candidates {
  const n = segStart.length - 1;
  const candStart = new Uint32Array(n + 1);
  for (let id = 1; id <= n; id++) {
    const len = (segStart[id] as number) - (segStart[id - 1] as number);
    candStart[id] = (candStart[id - 1] as number) + (len === 1 ? 4 : 2);
  }

  const candidateCount = candStart[n] as number;
  const candHead = new Uint32Array(candidateCount);
  const candDir = new Uint8Array(candidateCount);
  const candSeg = new Uint32Array(candidateCount);
  const candReversed = new Uint8Array(candidateCount);

  for (let id = 1; id <= n; id++) {
    const from = segStart[id - 1] as number;
    const to = segStart[id] as number;
    const at = candStart[id - 1] as number;

    if (to - from === 1) {
      const cell = segCells[from] as number;
      for (let d = 0; d < 4; d++) {
        candHead[at + d] = cell;
        candDir[at + d] = d;
        candSeg[at + d] = id;
        candReversed[at + d] = 0;
      }
      continue;
    }

    const tail = segCells[from] as number;
    const tailNext = segCells[from + 1] as number;
    const head = segCells[to - 1] as number;
    const headPrev = segCells[to - 2] as number;

    const dirFromHead = directionBetween(headPrev, head, width);
    const dirFromTail = directionBetween(tailNext, tail, width);
    if (dirFromHead === -1 || dirFromTail === -1) {
      throw new Error(
        `reverseConstruct: segment ${id} is not a walk of 4-neighbours ` +
          `(cells ${headPrev}->${head} or ${tailNext}->${tail})`,
      );
    }

    // Candidate 0 keeps the input's own tail -> head order (its "head" is
    // already segCells's last cell). Candidate 1 picks the opposite endpoint,
    // so emitting it as Board.segCells needs that segment's slice reversed.
    candHead[at] = head;
    candDir[at] = dirFromHead;
    candSeg[at] = id;
    candReversed[at] = 0;
    candHead[at + 1] = tail;
    candDir[at + 1] = dirFromTail;
    candSeg[at + 1] = id;
    candReversed[at + 1] = 1;
  }

  return { candHead, candDir, candSeg, candReversed };
}
