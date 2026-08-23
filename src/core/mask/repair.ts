/**
 * Repairs at half resolution and upscales afterwards, so every operation moves
 * whole 2x2 blocks. The input `Blob` must be block-aligned to offset (0, 0).
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
 * Large enough to close an incidental gap the open step leaves between two
 * lobes, small enough not to swallow a hole spanning a real fraction of the
 * region. In half-resolution cells.
 */
const DEFAULT_HOLE_AREA_THRESHOLD = 4;

/**
 * Throws `MaskRepairError` if repair removes every cell — a raw blob with no
 * 2-cell-thick interior for the open step to preserve — or if `absorbParity`
 * finds an imbalance too large to absorb.
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
 * OR-reduces each 2x2 block into one half-resolution cell — the inverse of
 * `upscale2x` when every block is uniformly all-in or all-out.
 *
 * An odd `width` or `height` leaves a row and/or column belonging to no block,
 * which cannot be represented at half resolution. Throws if that strip holds
 * an inside cell, rather than dropping it and losing area without a trace.
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
