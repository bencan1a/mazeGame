/**
 * One path per region, concatenated. A Hamiltonian path cannot jump the gap
 * between two lobes of a silhouette, so a multi-region mask is several
 * independent fill problems sharing one grid rather than one fill problem over
 * a disconnected region.
 *
 * Each region picks its own method: the contour first, backbite where the
 * region will not tile into 2x2 blocks. A region that neither method can fill
 * fails the whole stage — a board missing a lobe is not the silhouette that
 * was asked for.
 */

import { regionSubMask } from '../mask/regions.js';
import type { Rng } from '../rng.js';
import type { HamiltonianPath, Mask } from '../types.js';
import { buildBackbitePath } from './backbite.js';
import { buildContourPath } from './contour.js';

export interface RegionPathsOk {
  readonly ok: true;
  readonly path: HamiltonianPath;
  /** 1 where that region fell back to backbite, indexed by `regionId - 1`. */
  readonly usedBackbite: Uint8Array;
}

export interface RegionPathsFailed {
  readonly ok: false;
  readonly reason: string;
}

export type RegionPathsResult = RegionPathsOk | RegionPathsFailed;

/**
 * Fills every region of `mask` and concatenates the results in region-id
 * order, drawing from `contourRng` and `backbiteRng` as it goes.
 */
export function buildRegionPaths(
  mask: Mask,
  contourRng: Rng,
  backbiteRng: Rng,
  turnBias?: number,
): RegionPathsResult {
  const regionStart = new Uint32Array(mask.regionCount + 1);
  const cells = new Uint32Array(mask.pathCellCount);
  const usedBackbite = new Uint8Array(mask.regionCount);
  let written = 0;

  for (let region = 1; region <= mask.regionCount; region++) {
    const subMask = regionSubMask(mask, region);
    const contour = buildContourPath(subMask, contourRng, turnBias);
    let regionCells: Uint32Array;
    if (contour.ok) {
      regionCells = contour.path.cells;
    } else {
      const backbite = buildBackbitePath(subMask, backbiteRng);
      if (!backbite.ok) {
        return {
          ok: false,
          reason:
            `region ${region} of ${mask.regionCount} (${subMask.pathCellCount} cells): contour ` +
            `declined (${contour.reason}) and backbite failed: ${backbite.reason}`,
        };
      }
      usedBackbite[region - 1] = 1;
      regionCells = backbite.path.cells;
    }

    cells.set(regionCells, written);
    written += regionCells.length;
    regionStart[region] = written;
  }

  if (written !== mask.pathCellCount) {
    // A defensive assertion, not a reachable case: each builder returns
    // exactly its sub-mask's path cells, and those partition the mask's.
    return {
      ok: false,
      reason: `regions cover ${written} cells, mask.pathCellCount is ${mask.pathCellCount}`,
    };
  }

  return { ok: true, path: { cells, regionStart }, usedBackbite };
}
