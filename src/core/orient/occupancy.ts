/** Stamp a segmentation's cells with 1-based segment ids. */

import type { PeeledSegments } from '../segment/peelSegments.js';

export function occupancyFromSegments(
  segments: Pick<PeeledSegments, 'segStart' | 'segCells'>,
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
