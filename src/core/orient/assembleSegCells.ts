/**
 * Applies the per-segment `segReversed` flags to a `SegmentedPath`, reversing
 * each flagged slice in place so every segment runs tail -> head.
 */

import type { SegmentedPath } from '../segment/segmentPath.js';

export function assembleSegCells(
  segments: Pick<SegmentedPath, 'segStart' | 'segCells'>,
  segReversed: Uint8Array,
): Uint32Array {
  const { segStart, segCells } = segments;
  const segmentCount = segStart.length - 1;
  const out = new Uint32Array(segCells.length);

  for (let k = 0; k < segmentCount; k++) {
    const from = segStart[k] as number;
    const to = segStart[k + 1] as number;
    if (segReversed[k] === 1) {
      for (let i = from; i < to; i++) out[i] = segCells[to - 1 - (i - from)] as number;
    } else {
      for (let i = from; i < to; i++) out[i] = segCells[i] as number;
    }
  }

  return out;
}
