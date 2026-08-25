/**
 * The pipeline over a silhouette that is several disjoint lobes, shaped like
 * the coffee cup in the reference art: four stacked bands with gaps between
 * them, plus a plume above.
 *
 * `generateBoard` cannot be used directly because it draws its own blob, so
 * the stages are wired here from a hand-built mask instead.
 */

import { describe, expect, it } from 'vitest';
import { maskViolations, pathViolations } from '../../test/fixtures/postconditions.js';
import { buildAdjacencyGraph, colorSegments } from './color/index.js';
import { toIndex } from './grid.js';
import { maskFrom } from './mask/index.js';
import { buildBlockingGraph, occupancyFromSegments } from './orient/index.js';
import { buildRegionPaths } from './path/index.js';
import { generateBoardWithDiagnostics } from './generate.js';
import { createRng } from './rng.js';
import { peelSegments } from './segment/index.js';
import type { Board, GenParams, HamiltonianPath, Mask } from './types.js';
import { DEFAULT_GEN_PARAMS } from './types.js';
import { greedyClear, validateBoard } from './validate/index.js';

const GRID_SIZE = 48;

const PARAMS: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize: GRID_SIZE, seed: 11 };

/**
 * Rows of the cup, as `[y0, y1, x0, x1]` inclusive spans. Every span starts
 * even and has even length, so each lobe is a union of whole 2x2 blocks at
 * lattice offset (0, 0) — what the contour method needs, and what repair
 * would have produced.
 */
const CUP_SPANS: ReadonlyArray<readonly [number, number, number, number]> = [
  // Plume of steam.
  [2, 5, 26, 35],
  // Lid dome, stepped in to a curve.
  [8, 9, 14, 33],
  [10, 11, 12, 35],
  [12, 13, 10, 37],
  [14, 17, 8, 39],
  // Upper band.
  [20, 27, 6, 41],
  // Middle band.
  [30, 35, 8, 39],
  // Cup bottom, tapered.
  [38, 41, 10, 37],
  [42, 43, 12, 35],
  [44, 45, 14, 33],
];

function cupMask(): Mask {
  const size = GRID_SIZE * GRID_SIZE;
  const inside = new Uint8Array(size);
  for (const [y0, y1, x0, x1] of CUP_SPANS) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) inside[toIndex(x, y, GRID_SIZE)] = 1;
    }
  }
  return maskFrom({ width: GRID_SIZE, height: GRID_SIZE, inside, unvisited: new Uint8Array(size) });
}

function boardFrom(mask: Mask, seed: number): { board: Board; path: HamiltonianPath } {
  const root = createRng(seed);
  const paths = buildRegionPaths(mask, createRng(root.int(0x100000000)), PARAMS.bendProbability);
  if (!paths.ok) throw new Error(`buildRegionPaths declined: ${paths.reason}`);

  const peeled = peelSegments(
    paths.path,
    PARAMS,
    createRng(root.int(0x100000000)),
    GRID_SIZE,
    GRID_SIZE,
  );
  const occupancy = occupancyFromSegments(peeled, GRID_SIZE, GRID_SIZE);
  const segmentCount = peeled.segStart.length - 1;
  const { edgeStart, edgeTarget } = buildBlockingGraph({
    width: GRID_SIZE,
    height: GRID_SIZE,
    segmentCount,
    occupancy,
    segHead: peeled.segHead,
    segDir: peeled.segDir,
  });
  const board: Board = {
    width: GRID_SIZE,
    height: GRID_SIZE,
    params: PARAMS,
    segmentCount,
    occupancy,
    segStart: peeled.segStart,
    segCells: peeled.segCells,
    segHead: peeled.segHead,
    segDir: peeled.segDir,
    edgeStart,
    edgeTarget,
    segColor: colorSegments(
      buildAdjacencyGraph(occupancy, GRID_SIZE, GRID_SIZE, segmentCount),
      segmentCount,
    ),
  };
  return { board, path: paths.path };
}

describe('a silhouette in several disjoint lobes', () => {
  const mask = cupMask();

  it('is five separately 4-connected regions satisfying every S1 postcondition', () => {
    expect(mask.regionCount).toBe(5);
    expect(maskViolations(mask)).toEqual([]);
  });

  it('fills every region with its own Hamiltonian path', () => {
    const { path } = boardFrom(mask, PARAMS.seed);
    expect(path.cells.length).toBe(mask.pathCellCount);
    expect(pathViolations(path, mask)).toEqual([]);
  });

  it('generates a board that passes validation', () => {
    const { board } = boardFrom(mask, PARAMS.seed);
    expect(() => validateBoard(board, mask)).not.toThrow();
    expect(board.segmentCount).toBeGreaterThan(0);
  });

  it('keeps segment ids globally unique and every segment inside one region', () => {
    const { board } = boardFrom(mask, PARAMS.seed);
    const seenRegions = new Set<number>();
    for (let id = 1; id <= board.segmentCount; id++) {
      const from = board.segStart[id - 1] as number;
      const to = board.segStart[id] as number;
      const region = mask.regionOf[board.segCells[from] as number] as number;
      expect(region).toBeGreaterThan(0);
      seenRegions.add(region);
      for (let k = from; k < to; k++) {
        expect(mask.regionOf[board.segCells[k] as number]).toBe(region);
      }
    }
    expect(seenRegions.size).toBe(mask.regionCount);
  });

  it('lets a ray cross the gap between two lobes and block a segment in another', () => {
    const { board } = boardFrom(mask, PARAMS.seed);
    let crossRegionEdges = 0;
    for (let id = 1; id <= board.segmentCount; id++) {
      const region = mask.regionOf[board.segHead[id - 1] as number] as number;
      for (let e = board.edgeStart[id - 1] as number; e < (board.edgeStart[id] as number); e++) {
        const target = board.edgeTarget[e] as number;
        const targetCell = board.segCells[board.segStart[target - 1] as number] as number;
        if (mask.regionOf[targetCell] !== region) crossRegionEdges++;
      }
    }
    expect(crossRegionEdges).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed gives byte-identical arrays', () => {
    const a = boardFrom(mask, PARAMS.seed).board;
    const b = boardFrom(mask, PARAMS.seed).board;
    expect(Array.from(a.occupancy)).toEqual(Array.from(b.occupancy));
    expect(Array.from(a.segCells)).toEqual(Array.from(b.segCells));
    expect(Array.from(a.edgeTarget)).toEqual(Array.from(b.edgeTarget));
  });

  it('covers the plume, the lobe small enough to be dropped by mistake', () => {
    const { board } = boardFrom(mask, PARAMS.seed);
    const plumeRegion = mask.regionOf[toIndex(26, 2, GRID_SIZE)] as number;
    let covered = 0;
    for (let cell = 0; cell < mask.regionOf.length; cell++) {
      if (mask.regionOf[cell] !== plumeRegion) continue;
      expect(board.occupancy[cell]).not.toBe(0);
      covered++;
    }
    // 10 columns by 4 rows, the smallest lobe of the five.
    expect(covered).toBe(40);
  });
});

describe('generateBoard over a lobed silhouette', () => {
  it('produces a playable multi-region board from params alone', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const result = generateBoardWithDiagnostics({
        ...DEFAULT_GEN_PARAMS,
        gridSize: 100,
        seed,
        lobeCount: 4,
      });
      expect(result.mask.regionCount).toBe(4);
      expect(result.path.regionStart.length).toBe(5);
      expect(result.board.segmentCount).toBeGreaterThan(20);
      // validateBoard already ran inside generateBoard; this is the greedy
      // clear a player would have to complete.
      expect(greedyClear(result.board).stuck).toHaveLength(0);
    }
  }, 30_000);

  it('keeps every segment inside one lobe and still blocks across the gaps', () => {
    const { board, mask } = generateBoardWithDiagnostics({
      ...DEFAULT_GEN_PARAMS,
      gridSize: 100,
      seed: 2,
      lobeCount: 4,
    });

    let crossRegionEdges = 0;
    for (let id = 1; id <= board.segmentCount; id++) {
      const from = board.segStart[id - 1] as number;
      const to = board.segStart[id] as number;
      const region = mask.regionOf[board.segCells[from] as number] as number;
      for (let k = from; k < to; k++) {
        expect(mask.regionOf[board.segCells[k] as number]).toBe(region);
      }
      for (let e = board.edgeStart[id - 1] as number; e < (board.edgeStart[id] as number); e++) {
        const target = board.edgeTarget[e] as number;
        const targetCell = board.segCells[board.segStart[target - 1] as number] as number;
        if (mask.regionOf[targetCell] !== region) crossRegionEdges++;
      }
    }
    expect(crossRegionEdges).toBeGreaterThan(0);
  }, 30_000);

  it('is deterministic in (seed, lobeCount)', () => {
    const params = { ...DEFAULT_GEN_PARAMS, gridSize: 60, seed: 9, lobeCount: 3 };
    const a = generateBoardWithDiagnostics(params).board;
    const b = generateBoardWithDiagnostics(params).board;
    expect(Array.from(a.segCells)).toEqual(Array.from(b.segCells));
    expect(Array.from(a.edgeTarget)).toEqual(Array.from(b.edgeTarget));
  }, 30_000);
});
