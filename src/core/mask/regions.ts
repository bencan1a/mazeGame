/**
 * Regions are the 4-connected components of a mask's path cells. A silhouette
 * is not one connected mass — the reference art is stacked bands and a plume
 * of steam — and a Hamiltonian path cannot jump a gap, so each component
 * carries its own path.
 */

import { DIRECTIONS, NO_CELL, step } from '../grid.js';
import type { Mask } from '../types.js';

/** The parts of a `Mask` that are not derived from the other parts. */
export interface MaskGeometry {
  readonly width: number;
  readonly height: number;
  readonly inside: Uint8Array;
  readonly unvisited: Uint8Array;
}

export interface RegionLabels {
  /** 1-based region id per cell, 0 where the cell is not a path cell. */
  readonly regionOf: Uint16Array;
  readonly regionCount: number;
}

/**
 * Labels each 4-connected component of `{ inside && !unvisited }`, numbering
 * them in row-major order of their first cell.
 */
export function labelRegions(geometry: MaskGeometry): RegionLabels {
  const { width, height, inside, unvisited } = geometry;
  const size = width * height;
  const regionOf = new Uint16Array(size);
  let regionCount = 0;

  const isPathCell = (cell: number): boolean => inside[cell] === 1 && unvisited[cell] !== 1;

  const stack: number[] = [];
  for (let start = 0; start < size; start++) {
    if (!isPathCell(start) || regionOf[start] !== 0) continue;
    regionCount++;
    regionOf[start] = regionCount;
    stack.push(start);
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, width, height);
        if (next === NO_CELL || !isPathCell(next) || regionOf[next] !== 0) continue;
        regionOf[next] = regionCount;
        stack.push(next);
      }
    }
  }

  return { regionOf, regionCount };
}

/** A complete `Mask` from its geometry, with `pathCellCount` and the regions derived. */
export function maskFrom(geometry: MaskGeometry): Mask {
  const { width, height, inside, unvisited } = geometry;
  const { regionOf, regionCount } = labelRegions(geometry);
  let pathCellCount = 0;
  for (let i = 0; i < regionOf.length; i++) if (regionOf[i] !== 0) pathCellCount++;
  return { width, height, inside, unvisited, pathCellCount, regionOf, regionCount };
}

/** Path cells per region, indexed by `regionId - 1`. */
export function regionSizes(mask: Mask): Uint32Array {
  const sizes = new Uint32Array(mask.regionCount);
  for (let i = 0; i < mask.regionOf.length; i++) {
    const id = mask.regionOf[i] as number;
    if (id !== 0) sizes[id - 1] = (sizes[id - 1] as number) + 1;
  }
  return sizes;
}

/**
 * A single-region `Mask` holding only region `regionId`'s path cells, on the
 * same grid. The other regions and every unvisited cell read as outside, so a
 * path builder handed this one sees exactly one connected region to fill.
 */
export function regionSubMask(mask: Mask, regionId: number): Mask {
  if (!Number.isInteger(regionId) || regionId < 1 || regionId > mask.regionCount) {
    throw new RangeError(`regionSubMask: region ${regionId} is not one of 1..${mask.regionCount}`);
  }
  const size = mask.width * mask.height;
  const inside = new Uint8Array(size);
  const regionOf = new Uint16Array(size);
  let pathCellCount = 0;
  for (let i = 0; i < size; i++) {
    if (mask.regionOf[i] !== regionId) continue;
    inside[i] = 1;
    regionOf[i] = 1;
    pathCellCount++;
  }
  return {
    width: mask.width,
    height: mask.height,
    inside,
    unvisited: new Uint8Array(size),
    pathCellCount,
    regionOf,
    regionCount: 1,
  };
}
