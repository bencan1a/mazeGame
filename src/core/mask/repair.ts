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
 * 2-cell-thick interior for the open step to preserve — if `absorbParity`
 * finds an imbalance too large to absorb, or if the repaired mask's path
 * cells fail to partition into whole 2x2 blocks at lattice offset (0, 0).
 * Repairing at half resolution before the upscale is supposed to make the
 * last case unreachable; the check turns a broken guarantee into a loud,
 * retried failure here instead of a mask that only fails later, silently,
 * inside `classifyTiling`.
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
  const mask = absorbParity({
    width: full.width,
    height: full.height,
    inside: full.inside,
    unvisited: new Uint8Array(full.inside.length),
    pathCellCount: countInside(full.inside),
  });
  assertBlockAligned(mask);
  return mask;
}

/**
 * Verifies that `mask`'s path cells (`inside && !unvisited`, the definition
 * `classifyTiling` uses) partition into whole 2x2 blocks at lattice offset
 * (0, 0): every block is entirely on the path or entirely off it, and no path
 * cell sits in the row or column an odd `width`/`height` leaves outside every
 * block. Throws `MaskRepairError` naming the first violation found, matching
 * how the rest of this module already reports a repair that could not be
 * completed.
 */
export function assertBlockAligned(mask: Mask): void {
  const { width, height, inside, unvisited } = mask;
  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);
  const coveredWidth = halfWidth * 2;
  const coveredHeight = halfHeight * 2;

  const isPathCell = (index: number): boolean => inside[index] === 1 && unvisited[index] !== 1;

  for (let y = 0; y < height; y++) {
    const yCovered = y < coveredHeight;
    if (yCovered && coveredWidth === width) continue;
    for (let x = yCovered ? coveredWidth : 0; x < width; x++) {
      const index = toIndex(x, y, width);
      if (isPathCell(index)) {
        throw new MaskRepairError(
          `repaired mask has a path cell at (${x}, ${y}), in the row/column past the last full ` +
            `2x2 block at lattice offset (0, 0) of a ${width}x${height} mask — the repaired ` +
            'region is not block-aligned',
        );
      }
    }
  }

  for (let by = 0; by < halfHeight; by++) {
    const y0 = by * 2;
    for (let bx = 0; bx < halfWidth; bx++) {
      const x0 = bx * 2;
      const nw = isPathCell(toIndex(x0, y0, width));
      const ne = isPathCell(toIndex(x0 + 1, y0, width));
      const sw = isPathCell(toIndex(x0, y0 + 1, width));
      const se = isPathCell(toIndex(x0 + 1, y0 + 1, width));
      const pathCount = Number(nw) + Number(ne) + Number(sw) + Number(se);
      if (pathCount === 0 || pathCount === 4) continue;
      const label = (on: boolean): string => (on ? 'path' : 'off');
      throw new MaskRepairError(
        `repaired mask block (${bx}, ${by}) at full-res origin (${x0}, ${y0}) has ${pathCount} ` +
          `of 4 cells on the path: NW(${x0}, ${y0})=${label(nw)} NE(${x0 + 1}, ${y0})=${label(ne)} ` +
          `SW(${x0}, ${y0 + 1})=${label(sw)} SE(${x0 + 1}, ${y0 + 1})=${label(se)} — every 2x2 ` +
          'block must be wholly on the path or wholly off it',
      );
    }
  }
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
    if (yCovered && coveredWidth === width) continue;
    for (let x = yCovered ? coveredWidth : 0; x < width; x++) {
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
