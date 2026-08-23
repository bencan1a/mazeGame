/**
 * Reverse construction (#11): the orientation fallback for when local search
 * (#10) does not converge (docs/CONTRACTS.md "orientation (S3)", R2).
 *
 * Segmentation has already fixed which cells each segment owns (`segStart`/
 * `segCells`); orientation's only freedom is which endpoint is the head, and
 * `segDir` follows from the geometry of the terminal stroke at that end. So
 * each segment has exactly two candidate (head, dir) pairs — except a
 * single-cell segment, which has no terminal stroke to read a direction off
 * either end and so has all four directions as candidates instead.
 *
 * The PRD's framing ("slide segments in from the edge") is a construction
 * process; what this function actually runs is its mirror image, a **greedy
 * peel**: repeatedly take a still-present segment that has a candidate whose
 * exit ray is clear of every other still-present segment, fix that candidate
 * as its orientation, and remove it. Acyclicity falls out for free either way
 * you read the resulting order: a segment peeled at step t only ever depended
 * on segments already peeled before t (blockers before dependents), so there
 * is no cycle for `buildBlockingGraph` to find in the `segHead`/`segDir` this
 * produces. Read in reverse, that same order is the insertion order the PRD
 * describes, and — because every edge `id -> blocker` then has `id` after
 * `blocker` reversed to `blocker` after `id` — it is also a topological order
 * of the blocking digraph in the standard source-before-target sense. See
 * `ReverseConstructSuccess.peelOrder` for the precise claim; the two readings
 * are inverses of each other, not independent facts, so only one of them can
 * be "peelOrder itself" and it is the removal reading.
 *
 * A candidate's blocker set (which other segments sit on its ray) is a fixed
 * property of geometry — cells never move, only presence does — so it is
 * computed once per candidate against the untouched `occupancy`, and peeling
 * a segment only ever decrements a *count* of not-yet-peeled blockers for the
 * candidates waiting on it (Kahn's algorithm, the same shape `greedyClear`
 * uses). That makes this a single pass over the candidates' rays rather than
 * an O(segments^2) rescan of "what's left" after every removal.
 *
 * The peel is also *complete* over this fixed candidate set, not merely
 * best-effort: if any combination of endpoint choices makes the whole board's
 * blocking digraph acyclic, this function finds an acyclic one (not
 * necessarily that same combination, but one that works). Proof sketch: fix
 * such a satisfying combination and suppose, for contradiction, the peel
 * stalls with a non-empty set R of segments still unresolved. R's induced
 * blocking digraph under that satisfying combination is a subgraph of an
 * acyclic graph, hence acyclic itself, hence has a segment r whose blockers
 * under that combination all lie outside R — i.e. already peeled. That makes
 * r's corresponding candidate ready at this exact point in the peel
 * (`remaining` counts only still-present blockers), contradicting "stalled".
 * So `ok: false` means no acyclic orientation exists for this segmentation at
 * all — the fix is re-segmenting or re-pathing, not retrying orientation.
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
   * **Authoritative, contract-mandated** (docs/CONTRACTS.md "orientation",
   * issue #71): 1 means segment k's cells must be emitted in reverse of the
   * segmenter's order before writing them into `Board.segCells`, so `segHead`
   * ends up as the slice's *last* cell — the invariant
   * `src/core/validate/structure.ts` enforces. This is the field #10's
   * `orientSegments` fallback seam reads; `segCells` below is a convenience
   * derived from it, not a second source of truth.
   */
  readonly segReversed: Uint8Array;
  /**
   * Cells per segment, CSR-aligned with the input `segStart`, with
   * `segReversed` already applied: a convenience for a caller that wants a
   * ready-to-assemble `Board.segCells` without reading the flag itself.
   * **Apply one or the other, never both** — reversing an already-reversed
   * slice silently un-reverses it, which is exactly the "quiet failure mode"
   * CONTRACTS.md warns about, just reintroduced one layer up.
   */
  readonly segCells: Uint32Array;
  /**
   * Segment ids in the order the peel removed them: every blocker appears
   * before the segments it blocks. Reversed, this is both the insertion
   * order the PRD describes, and a topological order of the blocking digraph
   * `buildBlockingGraph` will derive from `segHead`/`segDir` in the standard
   * sense (edge `id -> blocker` has `id` before `blocker`) — this array
   * itself is the removal order, which is that same order's inverse.
   */
  readonly peelOrder: Uint32Array;
}

export interface ReverseConstructFailure {
  readonly ok: false;
  /**
   * Segment ids that never had a candidate whose ray cleared: no acyclic
   * orientation exists for this segmentation at all (see the module-level
   * completeness argument above), so the recovery is re-segmenting or
   * re-pathing, not retrying orientation. Expected to be rare-to-never (see
   * the property test), not a normal outcome to route around silently.
   */
  readonly stuck: Uint32Array;
}

export type ReverseConstructResult = ReverseConstructSuccess | ReverseConstructFailure;

/**
 * The fallback entry point #10 calls when local search times out.
 *
 * `segments` takes the CSR pair `segmentPath` produces (a `Pick`, not the
 * full `SegmentedPath`, since a caller assembling a partial board naturally
 * has just these two arrays rather than a complete type). `occupancy` is
 * cell -> segment id (0 empty), matching `Board.occupancy`, already fixed by
 * segmentation and independent of any orientation choice.
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

  // Ready candidates, order-free: which one is picked when several qualify is
  // an explicit, seeded choice (a quality knob, not incidental to iteration
  // order), via swap-removal so the pick stays O(1).
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
 * Two head/direction candidates per segment (its two endpoints, each paired
 * with the direction of its own terminal stroke), or four for a single-cell
 * segment, which has no terminal stroke at all — its neighbours in the
 * original Hamiltonian path belong to the *adjacent* segments, not this one,
 * so nothing here constrains its exit direction and every one of N/E/S/W is
 * geometrically valid.
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
