import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { directionBetween } from '../grid.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import type { GenParams, HamiltonianPath } from '../types.js';
import { makeMask, makePath, makePathFromCells } from '../../../test/fixtures/index.js';
import { peelSegments } from './peelSegments.js';
import type { PeeledSegments } from './peelSegments.js';

function paramsAt(overrides: Partial<GenParams>): GenParams {
  return { ...DEFAULT_GEN_PARAMS, ...overrides };
}

/** The cells of segment k, in the order the peel emitted them (tail -> head). */
function sliceOf(result: PeeledSegments, k: number): number[] {
  const from = result.segStart[k] as number;
  const to = result.segStart[k + 1] as number;
  return Array.from(result.segCells.slice(from, to));
}

/** Undoes `segReversed`, so the concatenation should be `path.cells` again. */
function inPathOrder(result: PeeledSegments): number[] {
  const out: number[] = [];
  for (let k = 0; k < result.segStart.length - 1; k++) {
    const slice = sliceOf(result, k);
    out.push(...(result.segReversed[k] === 1 ? slice.reverse() : slice));
  }
  return out;
}

describe('peelSegments: degenerate inputs', () => {
  it('answers an empty segmentation for an empty path', () => {
    const result = peelSegments(
      { cells: new Uint32Array(0) },
      DEFAULT_GEN_PARAMS,
      createRng(1),
      4,
      4,
    );
    expect(Array.from(result.segStart)).toEqual([0]);
    expect(result.segCells).toHaveLength(0);
    expect(result.stats.segmentCount).toBe(0);
  });

  it('cuts a one-cell path into one one-cell segment', () => {
    const mask = makeMask(['#.', '..'].join('\n'));
    const path = makePathFromCells(mask, [0]);
    const result = peelSegments(path, DEFAULT_GEN_PARAMS, createRng(1), 2, 2);
    expect(Array.from(result.segStart)).toEqual([0, 1]);
    expect(Array.from(result.segCells)).toEqual([0]);
    expect(result.segHead[0]).toBe(0);
    expect(Array.from(result.peelOrder)).toEqual([1]);
  });

  it('refuses a path whose consecutive cells are not 4-neighbours', () => {
    const path: HamiltonianPath = { cells: Uint32Array.from([0, 3]) };
    expect(() => peelSegments(path, DEFAULT_GEN_PARAMS, createRng(1), 4, 4)).toThrow(
      /not 4-neighbours/,
    );
  });
});

describe('peelSegments: the segmentation contract', () => {
  const mask = makeMask({ width: 12, height: 12 });
  const path = makePath(mask);

  it('reproduces the path exactly once every segment is put back in path order', () => {
    const result = peelSegments(path, paramsAt({ gridSize: 12 }), createRng(4), 12, 12);
    expect(inPathOrder(result)).toEqual(Array.from(path.cells));
  });

  it('leaves no segment empty and no cell in two segments', () => {
    const result = peelSegments(path, paramsAt({ gridSize: 12 }), createRng(4), 12, 12);
    const seen = new Set<number>();
    for (let k = 0; k < result.segStart.length - 1; k++) {
      const slice = sliceOf(result, k);
      expect(slice.length).toBeGreaterThan(0);
      for (const cell of slice) {
        expect(seen.has(cell)).toBe(false);
        seen.add(cell);
      }
    }
    expect(seen.size).toBe(path.cells.length);
  });

  it('puts every head last in its own slice, with segDir as the terminal stroke', () => {
    const result = peelSegments(path, paramsAt({ gridSize: 12 }), createRng(4), 12, 12);
    for (let k = 0; k < result.segStart.length - 1; k++) {
      const slice = sliceOf(result, k);
      expect(slice[slice.length - 1]).toBe(result.segHead[k]);
      if (slice.length >= 2) {
        const stroke = directionBetween(
          slice[slice.length - 2] as number,
          slice[slice.length - 1] as number,
          12,
        );
        expect(result.segDir[k]).toBe(stroke);
      }
    }
  });

  it('is a deterministic function of its rng seed', () => {
    const a = peelSegments(path, paramsAt({ gridSize: 12 }), createRng(9), 12, 12);
    const b = peelSegments(path, paramsAt({ gridSize: 12 }), createRng(9), 12, 12);
    expect(Array.from(a.segCells)).toEqual(Array.from(b.segCells));
    expect(Array.from(a.segDir)).toEqual(Array.from(b.segDir));
    expect(Array.from(a.peelOrder)).toEqual(Array.from(b.peelOrder));
  });

  it('tracks meanPieceLength', () => {
    for (const meanPieceLength of [3, 8, 20]) {
      const result = peelSegments(
        path,
        paramsAt({ gridSize: 12, meanPieceLength, pieceLengthVariance: 1 }),
        createRng(4),
        12,
        12,
      );
      expect(result.stats.meanLength).toBeGreaterThan(meanPieceLength * 0.6);
      expect(result.stats.meanLength).toBeLessThan(meanPieceLength * 1.4);
    }
  });
});

describe('peelSegments: the commit order is a removal order', () => {
  const mask = makeMask({ width: 14, height: 14 });
  const path = makePath(mask);

  it('never lets a segment block one committed before it', () => {
    // The whole design in one assertion: walk each segment's ray and check
    // every id it crosses was committed earlier. That is strictly stronger
    // than "the digraph is acyclic" — it names the topological order too.
    const width = 14;
    const result = peelSegments(path, paramsAt({ gridSize: 14 }), createRng(2), width, width);
    const count = result.segStart.length - 1;

    const occupancy = new Int32Array(width * width);
    for (let k = 0; k < count; k++) {
      for (const cell of sliceOf(result, k)) occupancy[cell] = k + 1;
    }
    const peelIndex = new Int32Array(count + 1);
    for (let i = 0; i < count; i++) peelIndex[result.peelOrder[i] as number] = i;

    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    for (let id = 1; id <= count; id++) {
      const head = result.segHead[id - 1] as number;
      const dir = result.segDir[id - 1] as number;
      let x = (head % width) + (dx[dir] as number);
      let y = Math.floor(head / width) + (dy[dir] as number);
      while (x >= 0 && y >= 0 && x < width && y < width) {
        const other = occupancy[y * width + x] as number;
        if (other !== 0 && other !== id) {
          expect(peelIndex[other] as number).toBeLessThan(peelIndex[id] as number);
        }
        x += dx[dir] as number;
        y += dy[dir] as number;
      }
    }
  });

  it('peels every segment exactly once', () => {
    const result = peelSegments(path, paramsAt({ gridSize: 14 }), createRng(2), 14, 14);
    const count = result.segStart.length - 1;
    expect(new Set(result.peelOrder).size).toBe(count);
    expect(Math.min(...result.peelOrder)).toBe(1);
    expect(Math.max(...result.peelOrder)).toBe(count);
  });
});

describe('peelSegments: stats', () => {
  it('reports lengths that match the segments it emitted', () => {
    const mask = makeMask({ width: 10, height: 10 });
    const path = makePath(mask);
    const result = peelSegments(path, paramsAt({ gridSize: 10 }), createRng(3), 10, 10);
    const count = result.segStart.length - 1;
    const lengths = Array.from({ length: count }, (_, k) => sliceOf(result, k).length);
    const mean = lengths.reduce((a, b) => a + b, 0) / count;
    expect(result.stats.segmentCount).toBe(count);
    expect(result.stats.meanLength).toBeCloseTo(mean, 10);
    expect(result.stats.belowMinimum).toBeLessThanOrEqual(result.stats.shortOfTarget);
  });

  it('is never short of a target it can always honour', () => {
    const mask = makeMask({ width: 8, height: 8 });
    const path = makePath(mask);
    const result = peelSegments(
      path,
      paramsAt({ gridSize: 8, meanPieceLength: 2, pieceLengthVariance: 0 }),
      createRng(3),
      8,
      8,
    );
    expect(result.stats.shortOfTarget).toBe(0);
    expect(result.stats.belowMinimum).toBe(0);
    // Overshoots instead: a lone cell left beside a two-cell piece could only
    // ever become an illegal piece, so it is absorbed.
    expect(result.stats.meanLength).toBeGreaterThanOrEqual(2);
    expect(result.stats.meanLength).toBeLessThan(3.5);
  });
});

describe('peelSegments: minPieceLength', () => {
  const mask = makeMask({ width: 16, height: 16 });
  const path = makePath(mask);

  function lengths(result: PeeledSegments): number[] {
    return Array.from({ length: result.segStart.length - 1 }, (_, k) => sliceOf(result, k).length);
  }

  it.each([2, 3, 4])('emits no segment shorter than %i cells', (minPieceLength) => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = peelSegments(
        path,
        paramsAt({ gridSize: 16, minPieceLength, meanPieceLength: 5, pieceLengthVariance: 3 }),
        createRng(seed),
        16,
        16,
      );
      expect(Math.min(...lengths(result))).toBeGreaterThanOrEqual(minPieceLength);
      expect(result.stats.belowMinimum).toBe(0);
    }
  });

  it('allows a lone arrowhead again at 1, so the floor is doing the work', () => {
    const withFloor = peelSegments(
      path,
      paramsAt({ gridSize: 16, minPieceLength: 1, meanPieceLength: 3, pieceLengthVariance: 3 }),
      createRng(11),
      16,
      16,
    );
    expect(Math.min(...lengths(withFloor))).toBe(1);
  });

  it('still honours the floor on a path too short to hold one whole piece', () => {
    // A one-cell path cannot satisfy a floor of two, so the peel relaxes
    // rather than failing, and says so.
    const tiny = makeMask(['#.', '..'].join('\n'));
    const result = peelSegments(
      makePathFromCells(tiny, [0]),
      paramsAt({ gridSize: 2, minPieceLength: 2 }),
      createRng(1),
      2,
      2,
    );
    expect(Array.from(result.segStart)).toEqual([0, 1]);
    expect(result.stats.belowMinimum).toBe(1);
  });
});

describe('peelSegments: taking a whole run to keep every piece legal', () => {
  // A plus, filled by a real backbite walk, asked for pieces of eight. Every
  // ordinary candidate at one step would have left a remnant too short to be
  // a legal piece of its own, so the only move left is a whole run — here the
  // sixteen-cell one. Without that move the peel would have to emit an
  // under-length piece instead.
  const PLUS = makeMask(
    [
      '....##..',
      '....##..',
      '..######',
      '..######',
      '..######',
      '..######',
      '....##..',
      '....##..',
    ].join('\n'),
  );
  const WALK = [
    29, 30, 38, 46, 47, 39, 31, 23, 22, 21, 13, 5, 4, 12, 20, 28, 27, 19, 18, 26, 34, 42, 43, 35,
    36, 37, 45, 44, 52, 60, 61, 53,
  ];

  it('reaches for it rather than emitting an under-length piece', () => {
    const result = peelSegments(
      makePathFromCells(PLUS, WALK),
      paramsAt({ gridSize: 8, minPieceLength: 8, meanPieceLength: 2, pieceLengthVariance: 0 }),
      createRng(1),
      8,
      8,
    );
    expect(result.stats.wholeRunEscapes).toBe(1);
    expect(result.stats.belowMinimum).toBe(0);
    const lengths = Array.from(
      { length: result.segStart.length - 1 },
      (_, k) => (result.segStart[k + 1] as number) - (result.segStart[k] as number),
    );
    expect(lengths).toEqual([8, 8, 16]);
  });
});
