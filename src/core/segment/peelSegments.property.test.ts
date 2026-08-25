/**
 * The peel against real geometry: blobs from `generateBlob`, filled by the
 * production contour path, at the sizes the game targets.
 *
 * Boustrophedon walks through full rectangles are not a substitute here. A
 * rectangle orients cleanly at every size whatever the segmentation does, so
 * a stage can look correct on one and still have no acyclic orientation on a
 * real silhouette.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../rng.js';
import { directionBetween } from '../grid.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import type { Board, GenParams, HamiltonianPath, Mask } from '../types.js';
import { generateBlob, repairMask } from '../mask/index.js';
import { buildContourPath } from '../path/index.js';
import { buildAdjacencyGraph, colorSegments } from '../color/index.js';
import { buildBlockingGraph, occupancyFromSegments } from '../orient/index.js';
import {
  checkCoverage,
  checkEdgesMatchRays,
  checkStructure,
  greedyClear,
} from '../validate/index.js';
import { peelSegments } from './peelSegments.js';
import type { PeeledSegments } from './peelSegments.js';

const REFERENCE_LIKE: Partial<GenParams> = { meanPieceLength: 5, pieceLengthVariance: 3 };

function maskFor(gridSize: number, seed: number): Mask {
  return repairMask(
    generateBlob({ gridSize, seed, fillFraction: DEFAULT_GEN_PARAMS.fillFraction }),
  );
}

function pathFor(mask: Mask, seed: number): HamiltonianPath | null {
  const result = buildContourPath(mask, createRng(seed));
  return result.ok ? result.path : null;
}

function assembleBoard(peeled: PeeledSegments, params: GenParams): Board {
  const { gridSize } = params;
  const occupancy = occupancyFromSegments(peeled, gridSize, gridSize);
  const segmentCount = peeled.segStart.length - 1;
  const { edgeStart, edgeTarget } = buildBlockingGraph({
    width: gridSize,
    height: gridSize,
    segmentCount,
    occupancy,
    segHead: peeled.segHead,
    segDir: peeled.segDir,
  });
  return {
    width: gridSize,
    height: gridSize,
    params,
    segmentCount,
    occupancy,
    segStart: peeled.segStart,
    segCells: peeled.segCells,
    segHead: peeled.segHead,
    segDir: peeled.segDir,
    edgeStart,
    edgeTarget,
    segColor: colorSegments(
      buildAdjacencyGraph(occupancy, gridSize, gridSize, segmentCount),
      segmentCount,
    ),
  };
}

/** Every id a segment's ray crosses, in the order the ray meets them. */
function rayIds(board: Board, id: number): number[] {
  const dx = [0, 1, 0, -1];
  const dy = [-1, 0, 1, 0];
  const dir = board.segDir[id - 1] as number;
  const head = board.segHead[id - 1] as number;
  const out: number[] = [];
  let x = (head % board.width) + (dx[dir] as number);
  let y = Math.floor(head / board.width) + (dy[dir] as number);
  while (x >= 0 && y >= 0 && x < board.width && y < board.height) {
    const other = board.occupancy[y * board.width + x] as number;
    if (other !== 0 && other !== id) out.push(other);
    x += dx[dir] as number;
    y += dy[dir] as number;
  }
  return out;
}

/** Everything the stage promises, checked against one real path. */
function violations(
  peeled: PeeledSegments,
  path: HamiltonianPath,
  mask: Mask,
  params: GenParams,
): string[] {
  const problems: string[] = [];
  const { gridSize } = params;
  const count = peeled.segStart.length - 1;

  const rebuilt: number[] = [];
  for (let k = 0; k < count; k++) {
    const from = peeled.segStart[k] as number;
    const to = peeled.segStart[k + 1] as number;
    const slice = Array.from(peeled.segCells.slice(from, to));
    if (slice.length < params.minPieceLength) {
      problems.push(`segment ${k + 1} is ${slice.length} cells, below minPieceLength`);
    }
    rebuilt.push(...(peeled.segReversed[k] === 1 ? [...slice].reverse() : slice));
  }
  if (rebuilt.length !== path.cells.length) {
    problems.push(`segments cover ${rebuilt.length} cells, path has ${path.cells.length}`);
  } else {
    for (let i = 0; i < rebuilt.length; i++) {
      if (rebuilt[i] !== path.cells[i]) {
        problems.push(`segments diverge from the path at position ${i}`);
        break;
      }
    }
  }

  const board = assembleBoard(peeled, params);
  for (const check of [
    () => checkStructure(board),
    () => checkCoverage(board, mask),
    () => checkEdgesMatchRays(board),
  ]) {
    try {
      check();
    } catch (err) {
      problems.push((err as Error).message);
    }
  }

  const clear = greedyClear(board);
  if (clear.stuck.length > 0) {
    problems.push(`blocking digraph has a cycle: ${clear.stuck.length} segment(s) never free`);
  }

  const peelIndex = new Int32Array(count + 1).fill(-1);
  for (let i = 0; i < count; i++) peelIndex[peeled.peelOrder[i] as number] = i;
  for (let id = 1; id <= count; id++) {
    if (peelIndex[id] === -1) {
      problems.push(`segment ${id} is missing from peelOrder`);
      continue;
    }
    for (const blocker of rayIds(board, id)) {
      if ((peelIndex[blocker] as number) >= (peelIndex[id] as number)) {
        problems.push(`segment ${id} exits through ${blocker}, which the peel commits no earlier`);
        break;
      }
    }
  }

  for (let k = 0; k < count; k++) {
    const from = peeled.segStart[k] as number;
    for (let i = from + 1; i < (peeled.segStart[k + 1] as number); i++) {
      if (
        directionBetween(
          peeled.segCells[i - 1] as number,
          peeled.segCells[i] as number,
          gridSize,
        ) === -1
      ) {
        problems.push(`segment ${k + 1} is not a connected walk`);
        break;
      }
    }
  }

  return problems;
}

describe.each([
  { gridSize: 40, numRuns: 30 },
  { gridSize: 100, numRuns: 8 },
])('peelSegments on real $gridSize x $gridSize paths', ({ gridSize, numRuns }) => {
  const params: GenParams = { ...DEFAULT_GEN_PARAMS, ...REFERENCE_LIKE, gridSize };

  it('holds every stage postcondition over contour paths', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (seed) => {
        const mask = maskFor(gridSize, seed);
        const path = pathFor(mask, seed);
        // A declining path stage is that stage's business, not this one's.
        fc.pre(path !== null);
        const peeled = peelSegments(path, params, createRng(seed), gridSize, gridSize);
        expect(violations(peeled, path, mask, params)).toEqual([]);
      }),
      { numRuns, seed: 20260823 },
    );
  }, 600_000);

  it(`never falls back to a stub segmentation on ${gridSize}x${gridSize} contour paths`, () => {
    // The failure this design trades into is ugliness, not "no board", so the
    // stats are the thing worth pinning: if the peel were routinely forced
    // down to one-cell pieces the board would generate and stop looking like
    // the reference art.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (seed) => {
        const mask = maskFor(gridSize, seed);
        const path = pathFor(mask, seed);
        fc.pre(path !== null);
        const { stats } = peelSegments(path, params, createRng(seed), gridSize, gridSize);
        expect(stats.segmentCount).toBeGreaterThan(0);
        expect(stats.belowMinimum).toBe(0);
        expect(stats.meanLength).toBeGreaterThan((REFERENCE_LIKE.meanPieceLength as number) * 0.8);
        expect(stats.shortOfTarget / stats.segmentCount).toBeLessThan(0.2);
        expect(stats.belowMinimum / stats.segmentCount).toBeLessThan(0.1);
      }),
      { numRuns, seed: 20260823 },
    );
  }, 600_000);
});
