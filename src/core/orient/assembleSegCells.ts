/**
 * Turns a `SegmentedPath` plus per-segment `segReversed` flags into the
 * `segCells` array a real `Board` needs.
 *
 * `segmentPath` hands every segment's cells in one fixed order - the order
 * the Hamiltonian path visited them - but `src/core/validate/structure.ts`
 * requires each segment's slice to run tail -> head, with `segHead` equal to
 * the slice's *last* cell. Whichever orienter (`orientByLocalSearch` here,
 * `reverseConstruct` in issue #11) picked the endpoint that was *not*
 * already last marks that segment `segReversed`, and this is where that
 * flag actually gets applied - reversing a slice in place, not rebuilding it
 * cell by cell from scratch.
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
