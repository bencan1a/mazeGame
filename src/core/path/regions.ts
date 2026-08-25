/**
 * One path per region, concatenated. A Hamiltonian path cannot jump the gap
 * between two lobes of a silhouette, so a multi-region mask is several
 * independent fill problems sharing one grid rather than one fill problem over
 * a disconnected region.
 *
 * A region the contour method declines fails the whole stage — a board missing
 * a lobe is not the silhouette that was asked for.
 */

import { regionSubMask } from '../mask/regions.js';
import type { Rng } from '../rng.js';
import type { HamiltonianPath, Mask } from '../types.js';
import { buildContourPath } from './contour.js';

export interface RegionPathsOk {
  readonly ok: true;
  readonly path: HamiltonianPath;
}

export interface RegionPathsFailed {
  readonly ok: false;
  readonly reason: string;
}

export type RegionPathsResult = RegionPathsOk | RegionPathsFailed;

/**
 * Fills every region of `mask` and concatenates the results in region-id
 * order, drawing from `contourRng` as it goes.
 */
export function buildRegionPaths(
  mask: Mask,
  contourRng: Rng,
  turnBias?: number,
): RegionPathsResult {
  const regionStart = new Uint32Array(mask.regionCount + 1);
  const cells = new Uint32Array(mask.pathCellCount);
  let written = 0;

  for (let region = 1; region <= mask.regionCount; region++) {
    const subMask = regionSubMask(mask, region);
    const contour = buildContourPath(subMask, contourRng, turnBias);
    if (!contour.ok) {
      return {
        ok: false,
        reason:
          `region ${region} of ${mask.regionCount} (${subMask.pathCellCount} cells): contour ` +
          `declined (${contour.reason})`,
      };
    }
    cells.set(contour.path.cells, written);
    written += contour.path.cells.length;
    regionStart[region] = written;
  }

  if (written !== mask.pathCellCount) {
    // A defensive assertion, not a reachable case: the contour returns exactly
    // its sub-mask's path cells, and those partition the mask's.
    return {
      ok: false,
      reason: `regions cover ${written} cells, mask.pathCellCount is ${mask.pathCellCount}`,
    };
  }

  return { ok: true, path: { cells, regionStart } };
}
