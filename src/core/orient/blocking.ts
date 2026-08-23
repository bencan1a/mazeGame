/**
 * The blocking digraph (S3, see docs/CONTRACTS.md "blocking digraph").
 *
 * An edge `j -> k` means "k must be removed before j can leave". Building the
 * graph only: acyclicity and orientation are #10/#11's, kept separate so both
 * can be tested against this file's output.
 */

import { NO_CELL, step } from '../grid.js';
import type { Board, Direction } from '../types.js';

/**
 * A `Pick` of `Board` rather than a bespoke type: orientation builds
 * `segHead`/`segDir` before the edge arrays exist, so callers hold a partial
 * board, and a second copy of those field types could drift from the contract.
 */
export type BlockingGraphInput = Pick<
  Board,
  'width' | 'height' | 'segmentCount' | 'occupancy' | 'segHead' | 'segDir'
>;

/** The CSR output half of `Board` this stage is responsible for. */
export type BlockingGraph = Pick<Board, 'edgeStart' | 'edgeTarget'>;

/**
 * Walks every segment's exit ray from its head to the board edge and records
 * which other segments it crosses.
 *
 * - A segment's own cells never block it, however many times the ray crosses
 *   them: that is what makes a clear head a guarantee of escape.
 * - One edge per *pair*, not per crossing — a bending segment can cross a
 *   straight ray more than once.
 * - Targets are sorted within each row; ray order is encounter order.
 */
export function buildBlockingGraph(input: BlockingGraphInput): BlockingGraph {
  const { width, height, segmentCount, occupancy, segHead, segDir } = input;
  const perSegment: number[][] = new Array<number[]>(segmentCount);

  for (let id = 1; id <= segmentCount; id++) {
    const dir = segDir[id - 1] as number;
    // segDir is a Uint8Array, so a stray -1 upstream arrives as 255, not a type
    // error. step() answers NO_CELL for it (#38), so the walk below would find
    // nothing — and "no blockers" reads as "this segment is free", a worse
    // answer than an error.
    if (!isDirection(dir)) {
      throw new Error(`segment ${id} has direction ${dir}, expected 0..3`);
    }

    const head = segHead[id - 1] as number;
    const seen = new Set<number>();
    const blockers: number[] = [];
    let cell = step(head, dir, width, height);
    while (cell !== NO_CELL) {
      const other = occupancy[cell] as number;
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
