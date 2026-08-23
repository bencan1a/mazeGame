import { describe, expect, it } from 'vitest';
import { NO_CELL, directionBetween, step } from '../grid.js';
import { createRng } from '../rng.js';
import type { Board, Direction, GenParams } from '../types.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { buildAdjacencyGraph } from '../color/adjacency.js';
import { colorSegments } from '../color/colorSegments.js';
import { segmentPath } from '../segment/segmentPath.js';
import { validateBoard } from '../validate/index.js';
import { isAcyclic } from '../../../test/fixtures/postconditions.js';
import { makeMask, makePath } from '../../../test/fixtures/index.js';
import type { ReverseConstructSuccess } from './reverseConstruct.js';
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
 * A minimal but real `Board` from a successful result, colours included, for
 * tests that hand it to `validateBoard` or to the shared fixture checkers
 * rather than re-deriving those checks locally.
 */
function toBoard(
  width: number,
  height: number,
  segStart: Uint32Array,
  occupancy: Uint16Array,
  result: ReverseConstructSuccess,
  params: GenParams,
): Board {
  const segmentCount = segStart.length - 1;
  const graph = buildBlockingGraph({
    width,
    height,
    segmentCount,
    occupancy,
    segHead: result.segHead,
    segDir: result.segDir,
  });
  const adjacency = buildAdjacencyGraph(occupancy, width, height, segmentCount);
  return {
    width,
    height,
    params,
    segmentCount,
    occupancy,
    segStart,
    segCells: result.segCells,
    segHead: result.segHead,
    segDir: result.segDir,
    edgeStart: graph.edgeStart,
    edgeTarget: graph.edgeTarget,
    segColor: colorSegments(adjacency, segmentCount),
  };
}

/**
 * Every segment's declared head is one of its *original* two endpoints, the
 * corrected `segCells` really does end at that head, and (for anything longer
 * than one cell) `segDir` matches the terminal stroke arriving at it — the
 * exact rule `src/core/validate/structure.ts` enforces, checked here against
 * this module's own output rather than trusted from its bookkeeping.
 */
function assertOrientationMatchesGeometry(
  segStart: Uint32Array,
  inputCells: Uint32Array,
  result: ReverseConstructSuccess,
  width: number,
): void {
  const n = segStart.length - 1;
  for (let id = 1; id <= n; id++) {
    const from = segStart[id - 1] as number;
    const to = segStart[id] as number;
    const head = result.segHead[id - 1] as number;
    const firstCell = inputCells[from] as number;
    const lastCell = inputCells[to - 1] as number;
    expect([firstCell, lastCell]).toContain(head);
    expect(result.segCells[to - 1]).toBe(head);

    if (to - from >= 2) {
      const before = result.segCells[to - 2] as number;
      expect(result.segDir[id - 1]).toBe(directionBetween(before, head, width));
    }
  }
}

/**
 * Independently replays `peelOrder` against a live copy of `occupancy`,
 * confirming each segment's chosen ray was actually clear of every
 * still-present segment at the moment the peel removed it. This is the
 * property the whole algorithm exists to guarantee, checked without trusting
 * the algorithm's own `remaining`/`waitingOn` bookkeeping.
 */
function assertPeelWasValid(
  result: ReverseConstructSuccess,
  segStart: Uint32Array,
  occupancy: Uint16Array,
  width: number,
  height: number,
): void {
  const live = Uint16Array.from(occupancy);
  for (const id of result.peelOrder) {
    const head = result.segHead[id - 1] as number;
    const dir = result.segDir[id - 1] as Direction;
    let cell = step(head, dir, width, height);
    while (cell !== NO_CELL) {
      const other = live[cell] as number;
      if (other !== 0 && other !== id) {
        throw new Error(`segment ${id} was peeled while its ray still crossed segment ${other}`);
      }
      cell = step(cell, dir, width, height);
    }
    const from = segStart[id - 1] as number;
    const to = segStart[id] as number;
    for (let k = from; k < to; k++) live[result.segCells[k] as number] = 0;
  }
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
    assertOrientationMatchesGeometry(segStart, segCells, result, 5);
    assertPeelWasValid(result, segStart, occupancy, 5, 1);
  });
});

describe('a single-cell segment has no terminal stroke, so all four directions are candidates', () => {
  it('assigns the lone cell as head with a direction whose ray is actually clear at peel time', () => {
    // A 3x3 board: the centre cell (index 4) is its own segment. Segment 2 is
    // a connected walk wrapping the north, east and south sides
    // (0 -> 1 -> 2 -> 5 -> 8 -> 7 -> 6); the west lane (cell 3) is never
    // assigned to any segment, so it stays empty on its own, not by an
    // explicit override.
    const width = 3;
    const height = 3;
    const segStart = Uint32Array.from([0, 1, 8]);
    const segCells = Uint32Array.from([4, 0, 1, 2, 5, 8, 7, 6]);
    const occupancy = occupancyFrom(segStart, segCells, width, height);

    const rng = createRng(7);
    const result = reverseConstruct({ segStart, segCells }, occupancy, width, height, rng);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.segHead[0]).toBe(4);
    // Which of the 4 directions wins depends on peel order (segment 2 can
    // vacate before segment 1 is even drawn - see the "seeded, not
    // incidental" describe block below for that in isolation), so the only
    // thing to assert is the invariant the peel actually guarantees: whatever
    // direction it picked, that ray was genuinely clear when it was peeled.
    assertPeelWasValid(result, segStart, occupancy, width, height);
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
    const params: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize: width };

    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      const result = reverseConstruct({ segStart, segCells }, occupancy, width, height, rng);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      assertOrientationMatchesGeometry(segStart, segCells, result, width);
      assertPeelWasValid(result, segStart, occupancy, width, height);

      const board = toBoard(width, height, segStart, occupancy, result, params);
      expect(isAcyclic(board)).toBe(true);
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

describe('assembles into a Board that validateBoard accepts', () => {
  it('a finely-cut 6x6 rectangle, exercising both endpoint choices, passes every S4 check', () => {
    const width = 6;
    const height = 6;
    const mask = makeMask({ width, height });
    const path = makePath(mask);
    const genParams: GenParams = {
      ...DEFAULT_GEN_PARAMS,
      gridSize: width,
      meanPieceLength: 3,
      pieceLengthVariance: 1,
      minStraightRun: 1,
    };
    const rng = createRng(11);
    const segmented = segmentPath(path, genParams, rng);
    const segmentCount = segmented.segStart.length - 1;
    const occupancy = occupancyFrom(segmented.segStart, segmented.segCells, width, height);

    const result = reverseConstruct(segmented, occupancy, width, height, rng);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Confirm this genuinely exercises the tail-as-head case (the reviewer's
    // reported bug), not just the endpoint the input order already agreed
    // with - otherwise this test would pass even with that bug back.
    let tailChosenAsHead = 0;
    for (let id = 1; id <= segmentCount; id++) {
      const from = segmented.segStart[id - 1] as number;
      if ((segmented.segCells[from] as number) === (result.segHead[id - 1] as number)) {
        tailChosenAsHead++;
      }
    }
    expect(tailChosenAsHead).toBeGreaterThan(0);

    // segReversed is the contract-mandated field (#10's fallback seam reads
    // it, not segCells); segCells is a convenience already-reversed copy.
    // They must never drift apart: segReversed[k] === 1 exactly when this
    // segment's corrected slice is the reverse of the input slice.
    for (let id = 1; id <= segmentCount; id++) {
      const from = segmented.segStart[id - 1] as number;
      const to = segmented.segStart[id] as number;
      const inputSlice = Array.from(segmented.segCells.subarray(from, to));
      const correctedSlice = Array.from(result.segCells.subarray(from, to));
      const isReversedSlice =
        inputSlice.length === correctedSlice.length &&
        inputSlice.every((cell, i) => cell === correctedSlice[correctedSlice.length - 1 - i]);
      const isSameSlice = inputSlice.every((cell, i) => cell === correctedSlice[i]);
      // A 1-cell segment's slice is trivially its own reverse - both
      // characterisations agree, so segReversed can only be checked against
      // the "already in the right order" reading for those.
      if (inputSlice.length <= 1) {
        expect(result.segReversed[id - 1]).toBe(0);
      } else {
        expect(isReversedSlice).toBe(!isSameSlice);
        expect(result.segReversed[id - 1]).toBe(isReversedSlice ? 1 : 0);
      }
    }

    assertOrientationMatchesGeometry(segmented.segStart, segmented.segCells, result, width);
    assertPeelWasValid(result, segmented.segStart, occupancy, width, height);

    const board = toBoard(width, height, segmented.segStart, occupancy, result, genParams);
    expect(() => validateBoard(board, mask)).not.toThrow();
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
      segReversed: new Uint8Array(0),
      segCells: new Uint32Array(0),
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
