/**
 * The blocking digraph (S3, see docs/CONTRACTS.md "blocking digraph").
 *
 * A segment k blocks segment j when something sits on j's exit ray between its
 * head and the board edge. An edge `j -> k` therefore means "k must be removed
 * before j can leave" — which is exactly the relation the orientation search
 * (#10, #11) needs to be acyclic, and the relation validation (#S4) checks a
 * topological sort of.
 *
 * This module only builds the graph. It does not decide whether the graph is
 * acyclic, and it does not orient anything — that is #10/#11's job, kept
 * separate so both can be built and tested against this file's output.
 */

import { NO_CELL, step } from '../grid.js';
import type { Board, Direction } from '../types.js';

/**
 * Everything `buildBlockingGraph` reads. A `Pick` of `Board` rather than a
 * bespoke type: orientation builds `segHead`/`segDir` before `edgeStart`/
 * `edgeTarget` exist, so callers naturally have a "board-ish" object that is
 * not yet a full `Board`, and this keeps that shape tied to the real contract
 * instead of a second copy of it that could drift.
 */
export type BlockingGraphInput = Pick<
  Board,
  'width' | 'height' | 'segmentCount' | 'occupancy' | 'segHead' | 'segDir'
>;

/** The CSR output half of `Board` this stage is responsible for. */
export type BlockingGraph = Pick<Board, 'edgeStart' | 'edgeTarget'>;

/**
 * Walk every segment's exit ray from its head to the board edge and record
 * which other segments it crosses.
 *
 * - A segment's own cells are skipped, however many times the ray crosses
 *   them: self-blocking would make a "clear head" meaningless, since the
 *   whole point of the rule is that a clear head guarantees escape.
 * - A blocker is recorded once per ray no matter how many times its cells
 *   appear on that ray (a long, bending segment can cross a straight ray more
 *   than once): the digraph has one edge per *pair*, not one per crossing.
 * - Edges are emitted sorted by target within each segment's row. Ray order is
 *   encounter order, not sorted order, so this is a real sort, not free.
 */
export function buildBlockingGraph(input: BlockingGraphInput): BlockingGraph {
  const { width, height, segmentCount, occupancy, segHead, segDir } = input;
  // Sized, not filled: every slot is assigned below, so pre-seeding each one
  // with a literal would allocate segmentCount arrays only to discard them.
  const perSegment: number[][] = new Array<number[]>(segmentCount);

  for (let id = 1; id <= segmentCount; id++) {
    const dir = segDir[id - 1] as number;
    // segDir is a Uint8Array, so a bug upstream (e.g. a stray -1) arrives here
    // as some value outside 0..3, not a type error. step() answers NaN for
    // such a direction (issue #38, not this file's to fix), and NaN is never
    // NO_CELL, so an unguarded `while (cell !== NO_CELL)` below would spin
    // forever. Validating the direction before the walk turns that hang into
    // a thrown error at the one place that can see it coming.
    if (!isDirection(dir)) {
      throw new Error(`segment ${id} has direction ${dir}, expected 0..3`);
    }

    const head = segHead[id - 1] as number;
    const seen = new Set<number>();
    const blockers: number[] = [];
    let cell = step(head, dir, width, height);
    while (cell !== NO_CELL) {
      const other = occupancy[cell] as number;
      // other === 0 is an empty cell; other === id is the segment's own body.
      // Neither blocks. seen.has(other) is the twice-crossed case: one edge.
      if (other !== 0 && other !== id && !seen.has(other)) {
        seen.add(other);
        blockers.push(other);
      }
      cell = step(cell, dir, width, height);
    }

    blockers.sort((a, b) => a - b);
    perSegment[id - 1] = blockers;
  }

  return toCsr(perSegment, segmentCount);
}

function isDirection(dir: number): dir is Direction {
  return dir === 0 || dir === 1 || dir === 2 || dir === 3;
}

function toCsr(perSegment: readonly (readonly number[])[], segmentCount: number): BlockingGraph {
  const edgeStart = new Uint32Array(segmentCount + 1);
  let total = 0;
  for (const row of perSegment) total += row.length;
  const edgeTarget = new Uint32Array(total);

  let at = 0;
  for (let id = 1; id <= segmentCount; id++) {
    edgeStart[id - 1] = at;
    for (const target of perSegment[id - 1] as readonly number[]) edgeTarget[at++] = target;
  }
  edgeStart[segmentCount] = at;

  return { edgeStart, edgeTarget };
}
