import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Board, GenParams, HamiltonianPath, Mask } from './types.js';
import { BoardInvariantError, DEFAULT_GEN_PARAMS } from './types.js';
import {
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  THREE_CYCLE_BOARD,
  THREE_CYCLE_BOARD_ART,
  TWO_CYCLE_BOARD,
  TWO_CYCLE_BOARD_ART,
  makeBoardAndMask,
} from '../../test/fixtures/index.js';
import { createRng, shuffle } from './rng.js';
import { greedyClear } from './validate/greedyClear.js';
import { GenerationFailedError, generateBoardWithDiagnostics } from './generate.js';
import { computeMetrics } from './metrics.js';
import type { MetricsContext } from './metrics.js';

const { board: acyclicBoard, mask: acyclicMask } = makeBoardAndMask({
  art: ACYCLIC_BOARD_ART,
  walks: ACYCLIC_BOARD_WALKS,
});

/**
 * A synthetic board's segments need not join into one walk — ACYCLIC_BOARD's
 * do not — so bendRate gets an explicit path, and an empty one everywhere it
 * is not the metric under test.
 */
const NO_PATH: HamiltonianPath = { cells: new Uint32Array(0) };

function context(mask: Mask, generationMs = 0, path: HamiltonianPath = NO_PATH): MetricsContext {
  return { mask, path, generationMs };
}

describe('computeMetrics on ACYCLIC_BOARD', () => {
  // aaaa   a = {0,1,2,3,7}, b = {9,8,4,5,6} (tail -> head), c = {10,11,15,14,13,12}
  // bbBA   Every one of the 16 cells is inside and covered, so coverage is 1.
  // bbcc   The greedy clear order is c, a, b (see greedyClear.test.ts), with
  // Cccc   depth [a=2, b=3, c=1] and a free set of size 1 at every step.
  const metrics = computeMetrics(acyclicBoard, context(acyclicMask, 12.5));

  it('reports segment count and coverage', () => {
    expect(metrics.segmentCount).toBe(3);
    expect(metrics.coverage).toBe(1);
  });

  it('reports mean segment length as total path cells over segment count', () => {
    expect(metrics.meanSegmentLength).toBeCloseTo(16 / 3);
  });

  it('reports bend rate as corners over the interior cells of the walk', () => {
    // 0 -> 1 -> 2 -> 3 -> 7 -> 6 on a 4-wide grid: East, East, East, South,
    // West. Corners at cells 3 and 7, of 4 interior cells (1, 2, 3, 7).
    const walk: HamiltonianPath = { cells: Uint32Array.from([0, 1, 2, 3, 7, 6]) };
    const withWalk = computeMetrics(acyclicBoard, context(acyclicMask, 0, walk));
    expect(withWalk.bendRate).toBeCloseTo(0.5);
  });

  it('reads dagDepth off the longest chain the greedy clear reports', () => {
    expect(metrics.dagDepth).toBe(3);
  });

  it('reads free-set stats off the same greedy clear', () => {
    expect(metrics.meanFreeSetSize).toBe(1);
    expect(metrics.minFreeSetSize).toBe(1);
  });

  it('reports the declared blocking edge count', () => {
    expect(metrics.edgeCount).toBe(2);
  });

  it('passes generationMs through unchanged, since core cannot read a clock itself', () => {
    expect(metrics.generationMs).toBe(12.5);
  });
});

describe('computeMetrics on a board with an unvisited cell', () => {
  // A: single-cell segment, head, exits north off the board (no blockers).
  // o: inside the mask but off the path — deliberately not covered.
  const { board, mask } = makeBoardAndMask({ art: 'Ao', dirs: { a: 'N' } });

  it('excludes the unvisited cell from coverage', () => {
    const metrics = computeMetrics(board, context(mask, 0));
    expect(metrics.coverage).toBeCloseTo(0.5);
  });

  it('reports minFreeSetSize as the segment count when nothing ever blocks', () => {
    const metrics = computeMetrics(board, context(mask, 0));
    expect(metrics.minFreeSetSize).toBe(metrics.segmentCount);
    expect(metrics.edgeCount).toBe(0);
  });
});

describe('computeMetrics on a board with no segments and a mask with no inside cells', () => {
  it('reports zero for every ratio rather than dividing by zero', () => {
    const board: Board = {
      width: 1,
      height: 1,
      params: { ...DEFAULT_GEN_PARAMS, gridSize: 1 },
      segmentCount: 0,
      occupancy: new Uint16Array(1),
      segStart: new Uint32Array(1),
      segCells: new Uint32Array(0),
      segHead: new Uint32Array(0),
      segDir: new Uint8Array(0),
      edgeStart: new Uint32Array(1),
      edgeTarget: new Uint32Array(0),
      segColor: new Uint8Array(0),
    };
    const mask: Mask = {
      width: 1,
      height: 1,
      inside: new Uint8Array(1),
      unvisited: new Uint8Array(1),
      pathCellCount: 0,
    };

    const metrics = computeMetrics(board, context(mask, 0));
    expect(metrics.segmentCount).toBe(0);
    expect(metrics.coverage).toBe(0);
    expect(metrics.meanSegmentLength).toBe(0);
    expect(metrics.bendRate).toBe(0);
    expect(metrics.dagDepth).toBe(0);
    expect(metrics.meanFreeSetSize).toBe(0);
    expect(metrics.minFreeSetSize).toBe(0);
    expect(metrics.edgeCount).toBe(0);
  });
});

describe('computeMetrics on an unsolvable board', () => {
  it.each([
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD, TWO_CYCLE_BOARD_ART, [1, 2]],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD, THREE_CYCLE_BOARD_ART, [1, 2, 3]],
  ])('throws BoardInvariantError naming the stuck segments of %s', (_name, cyclic, art, stuck) => {
    const { mask } = makeBoardAndMask({ art });
    expect(() => computeMetrics(cyclic, context(mask, 0))).toThrow(BoardInvariantError);
    for (const id of stuck) {
      expect(() => computeMetrics(cyclic, context(mask, 0))).toThrow(new RegExp(String(id)));
    }
  });
});

describe('computeMetrics free-set statistics, cross-checked against greedyClear directly', () => {
  it('matches an independently computed mean, min, and dagDepth over random acyclic boards', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 0, max: 2 ** 30 }),
        (n, seed) => {
          const rng = createRng(seed);
          const perSegment: number[][] = Array.from({ length: n }, () => []);
          for (let k = 2; k <= n; k++) {
            const edgeCount = rng.int(Math.min(3, k - 1) + 1);
            const candidates = shuffle(
              Array.from({ length: k - 1 }, (_, i) => i + 1),
              rng,
            );
            for (let e = 0; e < edgeCount; e++) perSegment[k - 1]?.push(candidates[e] as number);
          }
          const board = boardFromEdges(perSegment);
          const mask: Mask = {
            width: board.width,
            height: board.height,
            inside: new Uint8Array(board.width * board.height).fill(1),
            unvisited: new Uint8Array(board.width * board.height),
            pathCellCount: board.width * board.height,
          };

          const clear = greedyClear(board);
          let expectedDepth = 0;
          for (const d of clear.depth) if (d > expectedDepth) expectedDepth = d;
          let expectedTotal = 0;
          let expectedMin = n;
          for (let step = 0; step < clear.freeSetSizes.length; step++) {
            const freeSize = clear.freeSetSizes[step] as number;
            expectedTotal += freeSize;
            const blocked = n - step - freeSize;
            if (blocked > 0 && freeSize < expectedMin) expectedMin = freeSize;
          }

          const metrics = computeMetrics(board, context(mask, 0));
          expect(metrics.dagDepth).toBe(expectedDepth);
          expect(metrics.meanFreeSetSize).toBeCloseTo(expectedTotal / n);
          expect(metrics.minFreeSetSize).toBe(expectedMin);
          expect(metrics.edgeCount).toBe(board.edgeTarget.length);
        },
      ),
    );
  });

  it('reports minFreeSetSize as segmentCount whenever no segment ever blocks another', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (n) => {
        const board = boardFromEdges(Array.from({ length: n }, () => []));
        const mask: Mask = {
          width: board.width,
          height: board.height,
          inside: new Uint8Array(board.width * board.height).fill(1),
          unvisited: new Uint8Array(board.width * board.height),
          pathCellCount: board.width * board.height,
        };
        const metrics = computeMetrics(board, context(mask, 0));
        expect(metrics.minFreeSetSize).toBe(n);
      }),
    );
  });
});

describe('computeMetrics on real generated boards', () => {
  function generated(
    params: GenParams,
  ): { board: Board; mask: Mask; path: HamiltonianPath } | null {
    try {
      const { board, mask, path } = generateBoardWithDiagnostics(params);
      return { board, mask, path };
    } catch (err) {
      // Below roughly gridSize 12 the mask stage runs out of region to repair
      // and declines for every internal seed. That is its business, not this
      // stage's, so the case is skipped rather than failed.
      if (err instanceof GenerationFailedError) return null;
      throw err;
    }
  }

  it('keeps every fraction-valued metric in range and every count-valued one within segmentCount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 8, max: 24 }),
        (seed, gridSize) => {
          const params: GenParams = { ...DEFAULT_GEN_PARAMS, seed, gridSize };
          const real = generated(params);
          fc.pre(real !== null);
          const { board, mask, path } = real;
          const metrics = computeMetrics(board, { mask, path, generationMs: 1 });

          expect(metrics.segmentCount).toBe(board.segmentCount);
          expect(metrics.coverage).toBeGreaterThanOrEqual(0.99);
          expect(metrics.coverage).toBeLessThanOrEqual(1);
          expect(metrics.bendRate).toBeGreaterThanOrEqual(0);
          expect(metrics.bendRate).toBeLessThanOrEqual(1);
          expect(metrics.dagDepth).toBeGreaterThanOrEqual(1);
          expect(metrics.dagDepth).toBeLessThanOrEqual(metrics.segmentCount);
          expect(metrics.meanFreeSetSize).toBeGreaterThanOrEqual(1);
          expect(metrics.meanFreeSetSize).toBeLessThanOrEqual(metrics.segmentCount);
          expect(metrics.minFreeSetSize).toBeGreaterThanOrEqual(1);
          expect(metrics.minFreeSetSize).toBeLessThanOrEqual(metrics.segmentCount);
          expect(metrics.edgeCount).toBe(board.edgeTarget.length);
          expect(metrics.generationMs).toBe(1);
        },
      ),
      { numRuns: 25, seed: 20260824 },
    );
  });

  it('reads bendRate off the walk, so cutting the same path differently cannot move it', () => {
    // The metric exists as ground truth for how bendy the path generator makes
    // its walks. Measuring it per segment instead drops every cell at a cut,
    // which made it drift with meanPieceLength on an identical path.
    const base = { ...DEFAULT_GEN_PARAMS, gridSize: 40, seed: 11 };
    const rates = [3, 8, 25].map((meanPieceLength) => {
      const real = generated({ ...base, meanPieceLength });
      expect(real).not.toBeNull();
      const { board, mask, path } = real as { board: Board; mask: Mask; path: HamiltonianPath };
      return computeMetrics(board, { mask, path, generationMs: 0 }).bendRate;
    });
    expect(rates[1]).toBeCloseTo(rates[0] as number, 10);
    expect(rates[2]).toBeCloseTo(rates[0] as number, 10);
  });

  it('is deterministic: the same board and mask produce identical metrics', () => {
    const params: GenParams = { ...DEFAULT_GEN_PARAMS, seed: 42, gridSize: 16 };
    const real = generated(params);
    expect(real).not.toBeNull();
    const { board, mask, path } = real as { board: Board; mask: Mask; path: HamiltonianPath };
    const first = computeMetrics(board, { mask, path, generationMs: 3 });
    const second = computeMetrics(board, { mask, path, generationMs: 3 });
    expect(second).toEqual(first);
  });
});

/** A Board whose only real content is the blocking-edge CSR, for tests that only care about it. */
function boardFromEdges(perSegment: readonly number[][]): Board {
  const n = perSegment.length;
  const edgeStart = new Uint32Array(n + 1);
  const total = perSegment.reduce((sum, targets) => sum + targets.length, 0);
  const edgeTarget = new Uint32Array(total);
  let at = 0;
  for (let id = 1; id <= n; id++) {
    edgeStart[id - 1] = at;
    for (const target of perSegment[id - 1] as number[]) edgeTarget[at++] = target;
  }
  edgeStart[n] = at;

  return {
    width: 1,
    height: n,
    params: { ...DEFAULT_GEN_PARAMS, gridSize: n, meanPieceLength: 1, minStraightRun: 1 },
    segmentCount: n,
    occupancy: new Uint16Array(n),
    segStart: new Uint32Array(n + 1),
    segCells: new Uint32Array(n),
    segHead: new Uint32Array(n),
    segDir: new Uint8Array(n),
    edgeStart,
    edgeTarget,
    segColor: new Uint8Array(n),
  };
}
