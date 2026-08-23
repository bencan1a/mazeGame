/** An edge `j -> k` means "k must be removed before j can leave". */

import { NO_CELL, step } from '../grid.js';
import type { Board, Direction } from '../types.js';

export type BlockingGraphInput = Pick<
  Board,
  'width' | 'height' | 'segmentCount' | 'occupancy' | 'segHead' | 'segDir'
>;

export type BlockingGraph = Pick<Board, 'edgeStart' | 'edgeTarget'>;

/**
 * Walks every segment's exit ray from its head to the board edge and records
 * which other segments it crosses. A segment's own cells never block it.
 */
export function buildBlockingGraph(input: BlockingGraphInput): BlockingGraph {
  const { width, height, segmentCount, occupancy, segHead, segDir } = input;
  const perSegment: number[][] = new Array<number[]>(segmentCount);

  for (let id = 1; id <= segmentCount; id++) {
    const dir = segDir[id - 1] as number;
    // segDir is a Uint8Array, so a stray -1 arrives as 255 rather than as a
    // type error, and step() then answers NO_CELL: an unchecked walk would find
    // no blockers, which reads as "this segment is free".
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
