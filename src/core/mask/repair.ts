/**
 * Mask repair (PRD §4.2 step 1.2-1.5, issue #3): largest component, then
 * morphological open, then largest component again, then hole fill.
 * Checkerboard parity absorption (step 1.6, `unvisited`) is separate work
 * (#4); this module always returns `unvisited` all-zero.
 *
 * Repairs at half resolution, then upscales, rather than repairing the
 * already-upscaled full-resolution grid. `generateBlob` (#58) draws its raw
 * silhouette on a half-resolution lattice and upscales every cell into a
 * whole 2x2 block, which is what lets the spanning-tree contour path method
 * (#5) tile the region at all — a region not built from whole blocks falls
 * through to the (currently unimplemented, #6) backbite fallback. Eroding,
 * dilating, or filling a hole in a single full-resolution cell can turn a
 * whole block into a partial one and break that alignment; doing the same
 * operations at half resolution and upscaling the *result* with the same
 * whole-block mapping cannot, because every write is still in whole-block
 * units. It is also a quarter of the cells to visit. The trade is that
 * repaired outlines stay pixelated at 2-cell resolution, which `generateBlob`
 * already accepted for the same reason.
 *
 * This assumes the input `Blob` is 2x2-block-aligned to offset (0, 0), which
 * is true of every `generateBlob` output. `downsampleToHalfRes` OR-reduces
 * each block rather than sampling one corner, so a not-quite-aligned input
 * would still downsample to *something* representable at half resolution
 * (rounding a partially-set block up to full) instead of silently losing
 * whichever corner it happened to sample — but block alignment of the input
 * is what makes that downsampling lossless rather than merely safe.
 */

import { DIRECTIONS, NO_CELL, step, toIndex } from '../grid.js';
import type { Mask } from '../types.js';
import { type Blob, upscale2x } from './blob.js';
import { largestComponent } from './components.js';
import { fillHoles } from './holes.js';
import { morphologicalOpen } from './morphology.js';

export interface RepairOptions {
  /**
   * Interior holes at or below this many half-resolution cells are filled;
   * larger enclosed voids are left as a deliberate feature of the
   * silhouette. In half-resolution cells because that is where hole-filling
   * runs — one half-res cell is a 2x2 full-resolution block.
   */
  readonly holeAreaThreshold?: number;
}

/**
 * Small relative to a real board's area (PRD grid sizes 20..100, so 10..50
 * half-resolution cells per edge): filling a hole up to this many cells
 * closes an incidental gap the open step can leave between two lobes,
 * without swallowing a hole that spans a meaningful fraction of the region.
 */
const DEFAULT_HOLE_AREA_THRESHOLD = 4;

/**
 * Runs the largest-component / morphological-open / largest-component /
 * hole-fill pipeline over a raw `Blob` and returns a `Mask`.
 *
 * Beyond what the PRD names, this also prunes any cell left with fewer than
 * two inside 4-neighbours after the open and hole-fill: opening is
 * anti-extensive (its result is always a subset of the input) but is not, on
 * its own, guaranteed to remove a single-cell stub whose attachment point has
 * full 4-neighbour support — that cell can regrow in the dilate step. Pruning
 * only ever removes degree-0 or degree-1 cells from the inside-cell adjacency
 * graph, which cannot disconnect an already-connected region (removing a leaf
 * never disconnects the graph it is a leaf of), so no further
 * largest-component pass is needed afterwards.
 *
 * Throws if repair removes every cell — a raw blob with no 2-cell-thick
 * interior for the open step to preserve. `unvisited` is always all-zero:
 * parity absorption is #4.
 */
export function repairMask(blob: Blob, options: RepairOptions = {}): Mask {
  const holeAreaThreshold = options.holeAreaThreshold ?? DEFAULT_HOLE_AREA_THRESHOLD;

  let half = downsampleToHalfRes(blob);
  half = largestComponent(half);
  half = morphologicalOpen(half);
  half = largestComponent(half);
  half = fillHoles(half, holeAreaThreshold);
  half = pruneNarrowCells(half);

  if (countInside(half.inside) === 0) {
    throw new Error(
      'mask repair removed the entire region — the raw blob had no interior thick enough to ' +
        'survive the morphological open; try a larger gridSize or fillFraction',
    );
  }

  const full = upscale2x(half, blob.width, blob.height);
  return {
    width: full.width,
    height: full.height,
    inside: full.inside,
    unvisited: new Uint8Array(full.inside.length),
    pathCellCount: countInside(full.inside),
  };
}

/**
 * OR-reduces each 2x2 block of a block-aligned `Blob` into one half-resolution
 * cell. The inverse of `upscale2x` when every block is uniformly all-in or
 * all-out, which `generateBlob` guarantees.
 */
function downsampleToHalfRes(blob: Blob): Blob {
  const { width, height, inside } = blob;
  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);
  const out = new Uint8Array(halfWidth * halfHeight);

  for (let hy = 0; hy < halfHeight; hy++) {
    const y0 = hy * 2;
    for (let hx = 0; hx < halfWidth; hx++) {
      const x0 = hx * 2;
      const anyInside =
        inside[toIndex(x0, y0, width)] === 1 ||
        inside[toIndex(x0 + 1, y0, width)] === 1 ||
        inside[toIndex(x0, y0 + 1, width)] === 1 ||
        inside[toIndex(x0 + 1, y0 + 1, width)] === 1;
      out[hy * halfWidth + hx] = anyInside ? 1 : 0;
    }
  }

  return { width: halfWidth, height: halfHeight, inside: out };
}

/**
 * Removes, to a fixed point, every inside cell with fewer than two inside
 * 4-neighbours — the invariant `docs/CONTRACTS.md` requires of the finished
 * `Mask`. See the module doc comment for why morphological open alone does
 * not guarantee it and why this cannot disconnect an already-connected
 * region.
 */
function pruneNarrowCells(grid: Blob): Blob {
  const { width, height, inside } = grid;
  const size = width * height;
  const alive = inside.slice();
  const degree = new Uint8Array(size);
  const queue: number[] = [];

  for (let i = 0; i < size; i++) {
    if (alive[i] !== 1) continue;
    let count = 0;
    for (const dir of DIRECTIONS) {
      const n = step(i, dir, width, height);
      if (n !== NO_CELL && alive[n] === 1) count++;
    }
    degree[i] = count;
    if (count < 2) queue.push(i);
  }

  while (queue.length > 0) {
    const cell = queue.pop() as number;
    // Cells can be queued more than once (each drop below the threshold
    // re-queues), so a cell already removed by an earlier pop is a no-op.
    if (alive[cell] !== 1) continue;
    alive[cell] = 0;
    for (const dir of DIRECTIONS) {
      const n = step(cell, dir, width, height);
      if (n === NO_CELL || alive[n] !== 1) continue;
      const remaining = (degree[n] as number) - 1;
      degree[n] = remaining;
      if (remaining < 2) queue.push(n);
    }
  }

  return { width, height, inside: alive };
}

function countInside(inside: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i] === 1) count++;
  return count;
}
