import { describe, expect, it } from 'vitest';
import { directionBetween } from '../grid.js';
import { createRng } from '../rng.js';
import { reverseConstruct } from './reverseConstruct.js';
import { buildBlockingGraph } from './blocking.js';

/** Build occupancy (cell -> segment id, 0 empty) from a CSR segment list. */
function occupancyFrom(
  segStart: Uint32Array,
  segCells: Uint32Array,
  width: number,
  height: number,
): Uint16Array {
  const occupancy = new Uint16Array(width * height);
  const n = segStart.length - 1;
  for (let id = 1; id <= n; id++) {
    for (let k = segStart[id - 1] as number; k < (segStart[id] as number); k++) {
      occupancy[segCells[k] as number] = id;
    }
  }
  return occupancy;
}

/**
 * A minimal, self-contained topological sort over a CSR edge list — deliberately
 * not a re-import of `validate/greedyClear.ts` (a different stream owns that
 * file), just enough of the same Kahn's-algorithm shape to check the one thing
 * this test cares about: does every segment become free eventually.
 */
function isAcyclicAndFull(
  edgeStart: Uint32Array,
  edgeTarget: Uint32Array,
  segmentCount: number,
): boolean {
  const remaining = new Uint32Array(segmentCount);
  const blockedBy: number[][] = Array.from({ length: segmentCount + 1 }, () => []);
  for (let id = 1; id <= segmentCount; id++) {
    const from = edgeStart[id - 1] as number;
    const to = edgeStart[id] as number;
    remaining[id - 1] = to - from;
    for (let k = from; k < to; k++) (blockedBy[edgeTarget[k] as number] as number[]).push(id);
  }
  const queue: number[] = [];
  for (let id = 1; id <= segmentCount; id++) if (remaining[id - 1] === 0) queue.push(id);
  let cleared = 0;
  while (cleared < queue.length) {
    const id = queue[cleared] as number;
    cleared++;
    for (const waiter of blockedBy[id] as number[]) {
      remaining[waiter - 1] = (remaining[waiter - 1] as number) - 1;
      if (remaining[waiter - 1] === 0) queue.push(waiter);
    }
  }
  return cleared === segmentCount;
}

describe('a single segment spanning the whole path', () => {
  it('picks one of its two endpoints as head, with the matching terminal-stroke direction', () => {
    // One straight segment along a 5-cell row: cells 0..4, west to east.
    const segStart = Uint32Array.from([0, 5]);
    const segCells = Uint32Array.from([0, 1, 2, 3, 4]);
    const occupancy = occupancyFrom(segStart, segCells, 5, 1);
    const rng = createRng(1);

    const result = reverseConstruct({ segStart, segCells }, occupancy, 5, 1, rng);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Array.from(result.peelOrder)).toEqual([1]);
    const head = result.segHead[0] as number;
    const dir = result.segDir[0] as number;
    if (head === 4) {
      expect(dir).toBe(directionBetween(3, 4, 5));
    } else if (head === 0) {
      expect(dir).toBe(directionBetween(1, 0, 5));
    } else {
      throw new Error(`head ${head} is neither endpoint of the segment`);
    }
  });
});

describe('a single-cell segment has no terminal stroke, so all four directions are candidates', () => {
  it('assigns the lone cell as head with a direction whose ray is actually clear', () => {
    // A 3x3 board: the centre cell (index 4) is its own segment, surrounded on
    // three sides by another segment and open to the west. Only west reaches
    // the board edge without crossing the other segment.
    const width = 3;
    const height = 3;
    // cells: 0 1 2 / 3 4 5 / 6 7 8. Segment 2 takes every cell except the
    // centre (4) and the strip due west of it (3), which stays empty so the
    // west ray is genuinely clear all the way to the edge.
    const segStart = Uint32Array.from([0, 1, 8]);
    const segCells = Uint32Array.from([4, 0, 1, 2, 5, 6, 7, 8]);
    const occupancy = occupancyFrom(segStart, segCells, width, height);
    occupancy[3] = 0; // leave a clear lane west of the singleton

    const rng = createRng(7);
    const result = reverseConstruct({ segStart, segCells }, occupancy, width, height, rng);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.segHead[0]).toBe(4);
    // West (3) is the only direction whose ray never meets segment 2.
    expect(result.segDir[0]).toBe(3);
  });
});

describe('acyclic by construction', () => {
  it('a straight chain of segments always yields a fully-clearable blocking digraph', () => {
    const width = 9;
    const height = 1;
    // Five 1- or 2-cell segments end to end, unambiguous straight geometry.
    const segStart = Uint32Array.from([0, 2, 4, 6, 8, 9]);
    const segCells = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const occupancy = occupancyFrom(segStart, segCells, width, height);

    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      const result = reverseConstruct({ segStart, segCells }, occupancy, width, height, rng);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const graph = buildBlockingGraph({
        width,
        height,
        segmentCount: 5,
        occupancy,
        segHead: result.segHead,
        segDir: result.segDir,
      });
      expect(isAcyclicAndFull(graph.edgeStart, graph.edgeTarget, 5)).toBe(true);

      // Every candidate is one of the segment's own cells, and the reversed
      // peel order is a valid topological order (each segment's blockers all
      // precede it).
      const position = new Map<number, number>();
      result.peelOrder.forEach((id, index) => position.set(id, index));
      for (let id = 1; id <= 5; id++) {
        const from = graph.edgeStart[id - 1] as number;
        const to = graph.edgeStart[id] as number;
        for (let k = from; k < to; k++) {
          const blocker = graph.edgeTarget[k] as number;
          expect(position.get(id)).toBeGreaterThan(position.get(blocker) as number);
        }
      }
    }
  });
});

describe('failure is reported, not thrown or spun on', () => {
  it('a closed ring of four elbow segments, each depending on its two neighbours, never peels', () => {
    // Four 3-cell "elbow" segments deep inside an 6x6 grid (so no endpoint's
    // stroke ever points straight off the true board edge, which would be a
    // trivial, unconditional escape), each spanning from mid-edge, through one
    // corner, to the next mid-edge of a closed square ring:
    //
    //   .  TL TL TR TR .
    //   .  TL .  .  TR .
    //   .  .  .  .  .  .
    //   .  .  .  .  .  .
    //   .  BL .  .  BR .
    //   .  BL BL BR BR .
    //
    // Every segment's two candidates (its two endpoints) each have exactly one
    // blocker, its two neighbours round the ring (e.g. TL depends on TR to its
    // east and BL to its south). With every candidate starting at exactly one
    // blocker and none at zero, nothing can ever be the first to peel: the
    // ring is a genuine mutual dependency, not an artifact of a bad choice of
    // head, since reverseConstruct already tries both endpoints of every one.
    const width = 6;
    const height = 6;
    const idx = (x: number, y: number): number => y * width + x;
    const segTL = [idx(2, 1), idx(1, 1), idx(1, 2)];
    const segTR = [idx(3, 1), idx(4, 1), idx(4, 2)];
    const segBR = [idx(4, 3), idx(4, 4), idx(3, 4)];
    const segBL = [idx(1, 3), idx(1, 4), idx(2, 4)];
    const all = [segTL, segTR, segBR, segBL];

    const segStart = Uint32Array.from([0, 3, 6, 9, 12]);
    const segCells = Uint32Array.from(all.flat());
    const occupancy = occupancyFrom(segStart, segCells, width, height);

    const rng = createRng(3);
    const result = reverseConstruct({ segStart, segCells }, occupancy, width, height, rng);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Array.from(result.stuck).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

describe('the peel is seeded, not incidental to iteration order', () => {
  it('different seeds are free to choose different orientations for a fully-free segment', () => {
    // A 6-cell row cut into two 3-cell segments: both segments' inward ends
    // are mutually blocking, but a segment surrounded on both sides being
    // fully free at once is exactly the tie the rng breaks.
    const width = 6;
    const segStart = Uint32Array.from([0, 3, 6]);
    const segCells = Uint32Array.from([0, 1, 2, 3, 4, 5]);
    const occupancy = occupancyFrom(segStart, segCells, width, 1);

    const seenHeads = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const result = reverseConstruct({ segStart, segCells }, occupancy, width, 1, createRng(seed));
      expect(result.ok).toBe(true);
      if (result.ok) seenHeads.add(result.segHead[0] as number);
    }
    // Both of segment 1's endpoints are legal heads (cell 0 clears west off
    // the board immediately; cell 2 clears east once segment 2 is gone); a
    // fixed pick regardless of seed would mean the rng is not actually wired
    // into the choice.
    expect(seenHeads.size).toBeGreaterThan(1);
  });
});

describe('edge cases', () => {
  it('zero segments is a well-formed empty success, not a special case a caller must guard', () => {
    const segStart = Uint32Array.from([0]);
    const segCells = Uint32Array.from([]);
    const occupancy = new Uint16Array(9);
    const result = reverseConstruct({ segStart, segCells }, occupancy, 3, 3, createRng(1));
    expect(result).toEqual({
      ok: true,
      segHead: new Uint32Array(0),
      segDir: new Uint8Array(0),
      peelOrder: new Uint32Array(0),
    });
  });

  it('throws when a segment is not a walk of 4-neighbours, rather than deriving a bogus direction', () => {
    // segStart/segCells claims a 2-cell segment out of cells 0 and 2, which are
    // not 4-neighbours on a width-3 grid — malformed segmentation output, the
    // one thing this stage trusts and cannot itself repair.
    const segStart = Uint32Array.from([0, 2]);
    const segCells = Uint32Array.from([0, 2]);
    const occupancy = occupancyFrom(segStart, segCells, 3, 3);
    expect(() => reverseConstruct({ segStart, segCells }, occupancy, 3, 3, createRng(1))).toThrow(
      /segment 1 is not a walk of 4-neighbours/,
    );
  });
});

describe('determinism', () => {
  it('same segments, occupancy and seed always produce the same orientation', () => {
    const width = 7;
    const segStart = Uint32Array.from([0, 3, 7]);
    const segCells = Uint32Array.from([0, 1, 2, 3, 4, 5, 6]);
    const occupancy = occupancyFrom(segStart, segCells, width, 1);

    const a = reverseConstruct({ segStart, segCells }, occupancy, width, 1, createRng(42));
    const b = reverseConstruct({ segStart, segCells }, occupancy, width, 1, createRng(42));
    expect(a).toEqual(b);
  });
});
