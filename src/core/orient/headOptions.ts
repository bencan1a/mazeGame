/**
 * The legal head/direction candidates for every segment.
 *
 * A segment of length >= 2 has two: either endpoint as head, with `segDir`
 * fixed to that endpoint's terminal stroke. Head and direction are chosen
 * together, never independently.
 *
 * A length-1 segment has no terminal stroke to read a direction from — its one
 * cell is both endpoints — so it gets all four compass directions instead.
 *
 * `reversed` marks the candidates whose slice must be reversed for `segHead`
 * to end up last, since `segmentPath` emits one fixed order.
 *
 * Candidates are CSR: segment `k`'s options are `head[j]`/`dir[j]`/`reversed[j]`
 * for `j` in `[candStart[k], candStart[k + 1])`.
 */

import { directionBetween, opposite } from '../grid.js';
import type { Direction } from '../types.js';
import type { SegmentedPath } from '../segment/segmentPath.js';

export interface HeadCandidates {
  /** CSR offsets into `head`/`dir`/`reversed`. Length segmentCount + 1. */
  readonly candStart: Uint32Array;
  readonly head: Uint32Array;
  readonly dir: Uint8Array;
  /** 1 = reverse this segment's `segCells` slice so `segHead` is its last cell. */
  readonly reversed: Uint8Array;
}

export function computeHeadCandidates(segments: SegmentedPath, width: number): HeadCandidates {
  const { segStart, segCells } = segments;
  const segmentCount = segStart.length - 1;
  const candStart = new Uint32Array(segmentCount + 1);
  const head: number[] = [];
  const dir: number[] = [];
  const reversed: number[] = [];

  for (let k = 0; k < segmentCount; k++) {
    const first = segStart[k] as number;
    const last = (segStart[k + 1] as number) - 1;
    if (last < first)
      throw new Error(`segment ${k + 1} is empty (segStart[${k}]..segStart[${k + 1}])`);
    candStart[k] = head.length;

    if (last === first) {
      // A single cell reversed is itself, so which way the (degenerate)
      // slice runs makes no difference here; 0 for all four is as valid as
      // any other choice.
      const cell = segCells[first] as number;
      for (let d = 0; d < 4; d++) {
        head.push(cell);
        dir.push(d);
        reversed.push(0);
      }
    } else {
      const arriving = directionBetween(
        segCells[last - 1] as number,
        segCells[last] as number,
        width,
      ) as Direction;
      const leaving = directionBetween(
        segCells[first] as number,
        segCells[first + 1] as number,
        width,
      ) as Direction;
      // Head = last cell: already tail -> head as segmentPath produced it.
      head.push(segCells[last] as number);
      dir.push(arriving);
      reversed.push(0);
      // Head = first cell: the slice must be reversed so this cell ends up last.
      head.push(segCells[first] as number);
      dir.push(opposite(leaving));
      reversed.push(1);
    }
  }
  candStart[segmentCount] = head.length;

  return {
    candStart,
    head: Uint32Array.from(head),
    dir: Uint8Array.from(dir),
    reversed: Uint8Array.from(reversed),
  };
}
