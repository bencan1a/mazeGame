import { describe, expect, it } from 'vitest';
import { directionBetween, opposite } from '../grid.js';
import type { Direction } from '../types.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { computeHeadCandidates } from './headOptions.js';

const WIDTH = 5;

/** A single segment spanning the whole (flat) path, cells given in path order. */
function onePathSegment(cells: readonly number[]): SegmentedPath {
  return { segStart: Uint32Array.from([0, cells.length]), segCells: Uint32Array.from(cells) };
}

/** Candidate (head, dir, reversed) triples for segment `k`, in candStart order. */
function candidatesOf(
  candidates: ReturnType<typeof computeHeadCandidates>,
  k: number,
): [number, number, number][] {
  const from = candidates.candStart[k] as number;
  const to = candidates.candStart[k + 1] as number;
  const out: [number, number, number][] = [];
  for (let j = from; j < to; j++) {
    out.push([
      candidates.head[j] as number,
      candidates.dir[j] as number,
      candidates.reversed[j] as number,
    ]);
  }
  return out;
}

describe('multi-cell segments: exactly two candidates, one per endpoint', () => {
  it('a straight 3-cell segment (0,1,2 along row 0, heading east)', () => {
    const segments = onePathSegment([0, 1, 2]);
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidatesOf(candidates, 0)).toEqual([
      [2, 1, 0], // head = last cell (2) as-is: arriving direction East (1 -> 2), no reversal needed
      [0, 3, 1], // head = first cell (0): opposite of leaving (0 -> 1, East) = West, slice must reverse
    ]);
  });

  it('an L-shaped segment: the two candidates are each end own tangent, not opposites of each other', () => {
    // 0 -> 1 (east) -> 6 (south), on a width-5 grid: cells 0,1,6.
    const segments = onePathSegment([0, 1, 6]);
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidatesOf(candidates, 0)).toEqual([
      [6, 2, 0], // head = 6 as-is, last stroke (1 -> 6) is South
      [0, 3, 1], // head = 0, reversed; opposite of the first stroke (0 -> 1, East) = West
    ]);
  });
});

describe('length-1 segments get all four compass directions (matches #11 reverseConstruct.ts)', () => {
  it('a singleton segment in the middle of the path has 4 candidates, all at its one cell, none needing a reversal', () => {
    // Segment 1: cells [0, 1]. Segment 2 (singleton): cell [6]. Segment 3: cell [7].
    const segStart = Uint32Array.from([0, 2, 3, 4]);
    const segCells = Uint32Array.from([0, 1, 6, 7]);
    const segments: SegmentedPath = { segStart, segCells };
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidatesOf(candidates, 1)).toEqual([
      [6, 0, 0],
      [6, 1, 0],
      [6, 2, 0],
      [6, 3, 0],
    ]);
  });

  it('a singleton first or last segment of the whole path also gets 4 candidates', () => {
    const first: SegmentedPath = {
      segStart: Uint32Array.from([0, 1, 3]),
      segCells: Uint32Array.from([0, 1, 2]),
    };
    expect(candidatesOf(computeHeadCandidates(first, WIDTH), 0).map(([h]) => h)).toEqual([
      0, 0, 0, 0,
    ]);

    const last: SegmentedPath = {
      segStart: Uint32Array.from([0, 2, 3]),
      segCells: Uint32Array.from([0, 1, 2]),
    };
    expect(candidatesOf(computeHeadCandidates(last, WIDTH), 1).map(([h]) => h)).toEqual([
      2, 2, 2, 2,
    ]);
  });

  it('a 1-cell whole path (single segment) still gets 4 candidates', () => {
    const segments = onePathSegment([12]);
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidatesOf(candidates, 0)).toEqual([
      [12, 0, 0],
      [12, 1, 0],
      [12, 2, 0],
      [12, 3, 0],
    ]);
  });
});

describe('CSR shape', () => {
  it('candStart has length segmentCount + 1 and brackets head/dir/reversed', () => {
    const segStart = Uint32Array.from([0, 2, 3, 5]);
    const segCells = Uint32Array.from([0, 1, 6, 7, 8]);
    const segments: SegmentedPath = { segStart, segCells };
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidates.candStart.length).toBe(4); // 3 segments + 1
    expect(candidates.candStart[0]).toBe(0);
    expect(candidates.candStart[3]).toBe(candidates.head.length);
    expect(candidates.head.length).toBe(candidates.dir.length);
    expect(candidates.head.length).toBe(candidates.reversed.length);
  });
});

describe('sanity: multi-cell candidate directions always match a real terminal stroke', () => {
  it('the "head = last cell" candidate direction equals directionBetween of the segment last two cells', () => {
    const segStart = Uint32Array.from([0, 3, 5, 8]);
    const segCells = Uint32Array.from([0, 1, 2, 7, 12, 13, 14, 9]);
    const segments: SegmentedPath = { segStart, segCells };
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidatesOf(candidates, 0)[0]).toEqual([2, directionBetween(1, 2, WIDTH), 0]);
    expect(candidatesOf(candidates, 1)[0]).toEqual([12, directionBetween(7, 12, WIDTH), 0]);
  });

  it('the "head = first cell" candidate direction is the opposite of the leaving stroke, and is marked reversed', () => {
    const segments = onePathSegment([0, 1, 2]);
    const candidates = computeHeadCandidates(segments, WIDTH);
    expect(candidatesOf(candidates, 0)[1]).toEqual([
      0,
      opposite(directionBetween(0, 1, WIDTH) as Direction),
      1,
    ]);
  });
});
