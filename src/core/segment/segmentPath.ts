/**
 * Cuts a Hamiltonian path into segments. Every segment is a contiguous slice
 * of the walk, so concatenating them in order reproduces the path.
 *
 * Whether a straight run has room for a compliant cut is checked *before* a
 * cut is picked, not after. Checking only the chosen cut green-lights one that
 * looks fine assuming the run continues to its natural end, and a later cut
 * landing in the same run then invalidates it in hindsight.
 */

import { directionBetween } from '../grid.js';
import type { Rng } from '../rng.js';
import type { GenParams, HamiltonianPath } from '../types.js';

export interface SegmentedPath {
  /** CSR offsets into segCells. Length n+1; segment k occupies [segStart[k], segStart[k+1]). */
  readonly segStart: Uint32Array;
  /** Flattened per-segment polylines, ordered tail -> head, in path order. */
  readonly segCells: Uint32Array;
}

export function segmentPath(path: HamiltonianPath, params: GenParams, rng: Rng): SegmentedPath {
  const cells = path.cells;
  const length = cells.length;

  // A copy, not an alias: Board owns its arrays, so mutating the path
  // afterwards must not reach into the segmentation it produced.
  const segCells = new Uint32Array(cells);

  if (length === 0) {
    return { segStart: Uint32Array.from([0]), segCells };
  }

  // Boards are square, so gridSize is also the grid width.
  const width = params.gridSize;

  const edgeCount = length - 1;
  const dirs = new Uint8Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const from = cells[e] as number;
    const to = cells[e + 1] as number;
    const dir = directionBetween(from, to, width);
    if (dir === -1) {
      throw new Error(
        `segmentPath: path cells ${from} and ${to} (step ${e}) are not 4-neighbours; ` +
          'segmentPath requires a valid HamiltonianPath',
      );
    }
    dirs[e] = dir;
  }

  // Per edge, the inclusive bounds of the maximal run of consecutive edges
  // sharing its direction. Computed once and reused by every candidate cut.
  const runStart = new Int32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    runStart[e] = e === 0 || dirs[e] !== dirs[e - 1] ? e : (runStart[e - 1] as number);
  }
  const runEnd = new Int32Array(edgeCount);
  for (let e = edgeCount - 1; e >= 0; e--) {
    runEnd[e] = e === edgeCount - 1 || dirs[e] !== dirs[e + 1] ? e : (runEnd[e + 1] as number);
  }

  // Below 1 every position would be "roomless".
  const minStraightRun = Math.max(1, params.minStraightRun);

  /**
   * Whether cutting between cell `k` and cell `k + 1` is allowed, given the
   * current segment cannot start earlier than `pos`.
   *
   * A corner cut splits nothing straight and is always allowed. A cut inside a
   * straight run needs `minStraightRun` cells on both sides.
   */
  function isValidCut(k: number, pos: number): boolean {
    if (k <= 0 || k >= edgeCount) return true;
    const before = k - 1;
    const after = k;
    if (dirs[before] !== dirs[after]) return true;

    const rStart = Math.max(runStart[after] as number, pos);
    const rEnd = runEnd[after] as number;
    const validLo = rStart + minStraightRun - 1;
    const validHi = rEnd - minStraightRun + 1;
    if (validLo > validHi) return true; // no compliant split remains from here
    return k >= validLo && k <= validHi;
  }

  /**
   * The allowed cut nearest `target`, searching outward within `[pos, hi]`
   * (inclusive).
   */
  function nearestValidCut(target: number, pos: number, hi: number): number {
    const clamped = Math.min(Math.max(target, pos), hi);
    if (isValidCut(clamped, pos)) return clamped;
    for (let r = 1; r <= hi - pos; r++) {
      const down = clamped - r;
      if (down >= pos && isValidCut(down, pos)) return down;
      const up = clamped + r;
      if (up <= hi && isValidCut(up, pos)) return up;
    }
    // A floor rather than an infinite loop when no cut in range is valid.
    return clamped;
  }

  /**
   * The last cell of the straight run that begins at `pos` (or `pos` itself,
   * harmlessly, if `pos` is already the final cell of the path).
   */
  function runEndCellFrom(pos: number): number {
    if (pos >= edgeCount) return pos;
    return (runEnd[pos] as number) + 1;
  }

  const boundaries: number[] = []; // cut indices k, meaning "segment ends at cell k"
  const lastCell = length - 1;
  let pos = 0;
  while (pos < lastCell) {
    const runEndCell = runEndCellFrom(pos);
    // The most room this run can offer a cut starting at `pos`. Too little for
    // any compliant split, so absorb through to the run's end, which is a
    // corner or the path's end and always safe to have stopped at.
    if (runEndCell - pos + 1 < 2 * minStraightRun) {
      pos = runEndCell;
      continue;
    }

    const maxPieceLength = length - pos;
    const sampled = Math.round(rng.normal(params.meanPieceLength, params.pieceLengthVariance));
    const pieceLength = Math.min(Math.max(sampled, 1), maxPieceLength);
    const target = pos + pieceLength - 1;
    if (target >= lastCell) break; // this piece reaches the end: no cut needed

    const cut = nearestValidCut(target, pos, lastCell - 1);
    boundaries.push(cut);
    pos = cut + 1;
  }

  const segStart = new Uint32Array(boundaries.length + 2);
  segStart[0] = 0;
  for (let i = 0; i < boundaries.length; i++) segStart[i + 1] = (boundaries[i] as number) + 1;
  segStart[boundaries.length + 1] = length;

  return { segStart, segCells };
}
