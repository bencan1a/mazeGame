/**
 * Segmentation (S3, PRD §4.2 step 3): cut a Hamiltonian path into segments.
 *
 * A cut is a boundary between two consecutive path cells: everything up to
 * and including the boundary cell becomes one segment, everything after
 * starts the next. Because a segment is just a contiguous slice of the walk,
 * concatenating the segments in order reproduces the original path for free —
 * there is no reordering step to get wrong.
 *
 * Two things constrain where a boundary may land:
 *
 *  - `meanPieceLength` / `pieceLengthVariance` say how long a segment should
 *    be, on average — sampled per piece with `rng.normal`.
 *  - `minStraightRun` says a cut must not slice a straight run of the path
 *    into two pieces either of which is shorter than that many cells. A
 *    corner (the path bends exactly at the cut) is always a safe place to
 *    cut; the middle of a long straight stretch is not, because it leaves a
 *    stub too short to read as its own direction once the piece is a
 *    separate segment.
 *
 * The contract's escape hatch ("except where the path offers none") fires
 * when the straight run ahead of the current position is itself shorter than
 * `2 * minStraightRun` cells: no cut inside it can leave `minStraightRun`
 * cells on both sides. The check for that has to happen *before* picking a
 * cut, not after: checking only the cut actually chosen can green-light a cut
 * that looks fine in isolation (assuming the run continues to its natural
 * end) but is invalidated in hindsight by a later cut landing inside the same
 * run too soon. Checking room ahead of time, and simply not cutting inside a
 * run that has too little of it left, avoids that class of bug entirely
 * rather than detecting it after the fact. See `roomAheadOf` below.
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

/**
 * Cut `path` into segments per `params.meanPieceLength`,
 * `params.pieceLengthVariance` and `params.minStraightRun`.
 *
 * Pure function of its inputs — same path, params and rng draw sequence
 * always yields the same cuts. `rng` is threaded through rather than seeded
 * locally so a caller building a whole board from one seed gets one
 * reproducible draw sequence across every generator stage.
 */
export function segmentPath(path: HamiltonianPath, params: GenParams, rng: Rng): SegmentedPath {
  const cells = path.cells;
  const length = cells.length;

  // segCells is a copy of path.cells, not an alias: Board owns its own
  // arrays, so a caller must be free to discard or mutate the path
  // afterwards without that reaching into the segmentation it produced.
  const segCells = new Uint32Array(cells);

  if (length === 0) {
    // Degenerate input; nothing to cut. Not expected from a real
    // HamiltonianPath (pathCellCount is at least 1 for any non-empty mask)
    // but a single well-formed empty CSR is cheaper than a special case at
    // every call site.
    return { segStart: Uint32Array.from([0]), segCells };
  }

  // `gridSize` is the square board edge length (types.ts), and this
  // signature carries no separate width/height, so it is the only source of
  // grid width available for the index arithmetic below.
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

  // For every edge, the [start, end] (inclusive, edge indices) of the
  // maximal run of consecutive edges sharing its direction. Computed once in
  // two linear passes and reused by every candidate cut.
  const runStart = new Int32Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    runStart[e] = e === 0 || dirs[e] !== dirs[e - 1] ? e : (runStart[e - 1] as number);
  }
  const runEnd = new Int32Array(edgeCount);
  for (let e = edgeCount - 1; e >= 0; e--) {
    runEnd[e] = e === edgeCount - 1 || dirs[e] !== dirs[e + 1] ? e : (runEnd[e + 1] as number);
  }

  // A minStraightRun below 1 is not meaningful (every segment already has at
  // least 1 cell on each side of any cut); clamp rather than let a bad param
  // make every position "roomless".
  const minStraightRun = Math.max(1, params.minStraightRun);

  /**
   * Whether cutting between cell `k` and cell `k + 1` is allowed, given that
   * the current segment cannot start any earlier than `pos` (fixed by
   * wherever the previous cut landed).
   *
   * `k` is a corner cut (dirs[k-1] !== dirs[k], or off either end of the
   * path) whenever the direction changes right at the cut — always allowed,
   * because nothing straight is being split. Otherwise the cut lands inside
   * one straight run: allowed only if both slices are at least
   * `minStraightRun` cells. Callers only ever reach this for a run they have
   * already confirmed has room (see `roomAheadOf`), so the "no compliant
   * split remains" case is a defensive fallback rather than the normal path.
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
    // Unreachable when `roomAheadOf(pos)` held before this call, since that
    // guarantees a compliant k exists in range; a defensive floor beats an
    // infinite loop if that invariant is ever broken by a future edit.
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
    // Cells from `pos` through the run's own natural end (a genuine corner,
    // or the end of the path) — the most room this run could ever offer a
    // cut starting at `pos`. If that is not enough for *any* compliant
    // split, no cut we could place inside this run would fare better, no
    // matter what meanPieceLength asks for. Rather than force a cut anyway
    // (and rely on catching the violation after the fact), absorb straight
    // through to the run's end and let the next iteration decide afresh —
    // that next position is always a genuine corner or the path's end, both
    // unconditionally safe places to have stopped.
    if (runEndCell - pos + 1 < 2 * minStraightRun) {
      pos = runEndCell;
      continue;
    }

    const maxPieceLength = length - pos; // cells still available from pos to the end
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
