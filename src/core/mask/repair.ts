/**
 * Mask repair (PRD §4.2 steps 1.2-1.6): largest component, then morphological
 * open, then largest component again, then hole fill, then checkerboard
 * parity absorption (`absorbParity`, issue #4) to set `unvisited`.
 *
 * Repairs at half resolution, then upscales with `upscale2x`, rather than
 * repairing the already-upscaled full-resolution grid — see `blob.ts`
 * (module doc and `upscale2x`) for why block alignment matters and how
 * upscaling preserves it. Because `upscale2x` only ever writes whole 2x2
 * blocks, every full-resolution inside cell it produces already has at least
 * two inside 4-neighbours (its block-mate plus at least one neighbouring
 * block) regardless of the half-resolution region's shape — the finished
 * `Mask` needs no separate pass to enforce that.
 *
 * This assumes the input `Blob` is 2x2-block-aligned to offset (0, 0), which
 * is true of every `generateBlob` output; `downsampleToHalfRes` throws
 * rather than silently dropping cells if it is not (see there).
 */

import { toIndex } from '../grid.js';
import type { Mask } from '../types.js';
import { type Blob, upscale2x } from './blob.js';
import { largestComponent } from './components.js';
import { MaskRepairError } from './errors.js';
import { fillHoles } from './holes.js';
import { morphologicalOpen } from './morphology.js';
import { absorbParity } from './parity.js';

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
 * Throws `MaskRepairError` if repair removes every cell — a raw blob with no
 * 2-cell-thick interior for the open step to preserve. It can also throw
 * `MaskRepairError` from `absorbParity`, on a checkerboard imbalance too
 * large to absorb into `unvisited` — see that module; on this generator's
 * own output it measures as never happening (parity.test.ts's guard test),
 * since every step above stays 2x2-block-aligned.
 */
export function repairMask(blob: Blob, options: RepairOptions = {}): Mask {
  const holeAreaThreshold = options.holeAreaThreshold ?? DEFAULT_HOLE_AREA_THRESHOLD;

  let half = downsampleToHalfRes(blob);
  half = largestComponent(half);
  half = morphologicalOpen(half);
  half = largestComponent(half);
  half = fillHoles(half, holeAreaThreshold);

  if (countInside(half.inside) === 0) {
    throw new MaskRepairError(
      'mask repair removed the entire region — the raw blob had no interior thick enough to ' +
        'survive the morphological open; try a larger gridSize or fillFraction',
    );
  }

  const full = upscale2x(half, blob.width, blob.height);
  return absorbParity({
    width: full.width,
    height: full.height,
    inside: full.inside,
    unvisited: new Uint8Array(full.inside.length),
    pathCellCount: countInside(full.inside),
  });
}

/**
 * OR-reduces each 2x2 block of a block-aligned `Blob` into one half-resolution
 * cell — the inverse of `upscale2x` when every block is uniformly all-in or
 * all-out, which `generateBlob` guarantees.
 *
 * An odd `width` or `height` leaves one full-resolution row and/or column
 * (past `2 * halfWidth`/`2 * halfHeight`) that belongs to no block and so
 * cannot be represented at half resolution at all. `generateBlob` guarantees
 * that strip is empty, but this function does not trust that blindly: it
 * throws `MaskRepairError` if the strip holds any inside cell, rather than
 * silently dropping it, so a future non-block-aligned input fails loudly
 * instead of losing area without a trace.
 */
function downsampleToHalfRes(blob: Blob): Blob {
  const { width, height, inside } = blob;
  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);
  const coveredWidth = halfWidth * 2;
  const coveredHeight = halfHeight * 2;

  for (let y = 0; y < height; y++) {
    const yCovered = y < coveredHeight;
    for (let x = 0; x < width; x++) {
      if (yCovered && x < coveredWidth) continue;
      if (inside[toIndex(x, y, width)] === 1) {
        throw new MaskRepairError(
          `mask repair received a ${width}x${height} blob with an inside cell at (${x}, ${y}), ` +
            'in the leftover row/column no 2x2 block covers; the input is not block-aligned',
        );
      }
    }
  }

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
      out[toIndex(hx, hy, halfWidth)] = anyInside ? 1 : 0;
    }
  }

  return { width: halfWidth, height: halfHeight, inside: out };
}

function countInside(inside: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i] === 1) count++;
  return count;
}
