/**
 * Stamp a `SegmentedPath`'s cells with 1-based segment ids.
 *
 * `orientSegments`'s contract (docs/CONTRACTS.md "orientation") takes
 * `occupancy` as a caller-supplied argument, so this stage does not have to
 * build one — but every test and measurement here does, and so will the real
 * pipeline wiring once it exists. Kept as one small, honest function instead
 * of copy-pasted into every test file that needs an occupancy array.
 */

import type { SegmentedPath } from '../segment/segmentPath.js';

export function occupancyFromSegments(
  segments: SegmentedPath,
  width: number,
  height: number,
): Uint16Array {
  const occupancy = new Uint16Array(width * height);
  const segmentCount = segments.segStart.length - 1;
  for (let k = 0; k < segmentCount; k++) {
    const id = k + 1;
    const from = segments.segStart[k] as number;
    const to = segments.segStart[k + 1] as number;
    for (let i = from; i < to; i++) occupancy[segments.segCells[i] as number] = id;
  }
  return occupancy;
}
