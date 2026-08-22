/**
 * Builds the segment adjacency graph: an edge between two *different*
 * segments whenever a cell of one touches a cell of the other across a
 * 4-neighbour boundary.
 *
 * This is a different graph from the blocking digraph built in
 * `src/core/orient/` — adjacency is symmetric ("do these two pieces touch on
 * screen"), where blocking is directed ("must this one be removed before that
 * one"). Coloring only ever needs the former; do not confuse the two CSR
 * pairs even though both look like `{start, target}`.
 */
import { EAST, NO_CELL, SOUTH, step } from '../grid.js';
import type { AdjacencyGraph } from './types.js';

/**
 * `occupancy[i]` is the 1-based segment id at cell `i`, 0 for empty, matching
 * `Board.occupancy`. Passing primitives rather than a `Board` keeps this
 * buildable and testable without depending on the segmentation stream.
 */
export function buildAdjacencyGraph(
  occupancy: Uint16Array,
  width: number,
  height: number,
  segmentCount: number,
): AdjacencyGraph {
  // A segment's own body must never appear as its own neighbour (a self-loop
  // would poison the "colours taken by neighbours" set in colorSegments with
  // the segment's own eventual colour), and two segments that share many
  // cell boundaries are still one edge, exactly like a blocking ray that
  // crosses a segment twice — a Set dedupes both for free.
  const neighbours: Set<number>[] = Array.from({ length: segmentCount + 1 }, () => new Set());

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = occupancy[i] as number;
      if (id === 0) continue;
      // Checking only East and South (not all four directions) visits every
      // cell-to-cell contact exactly once instead of twice; the Set already
      // records the edge for both endpoints below.
      for (const dir of [EAST, SOUTH] as const) {
        const j = step(i, dir, width, height);
        if (j === NO_CELL) continue;
        const other = occupancy[j] as number;
        if (other === 0 || other === id) continue;
        (neighbours[id] as Set<number>).add(other);
        (neighbours[other] as Set<number>).add(id);
      }
    }
  }

  let total = 0;
  for (let id = 1; id <= segmentCount; id++) total += (neighbours[id] as Set<number>).size;

  const adjStart = new Uint32Array(segmentCount + 1);
  const adjTarget = new Uint32Array(total);
  let at = 0;
  for (let id = 1; id <= segmentCount; id++) {
    adjStart[id - 1] = at;
    // Sorted so the CSR slice is deterministic run to run, not merely correct
    // as an unordered set — determinism is a hard requirement (ADR-0004).
    const sorted = Array.from(neighbours[id] as Set<number>).sort((a, b) => a - b);
    for (const target of sorted) adjTarget[at++] = target;
  }
  adjStart[segmentCount] = at;

  return { adjStart, adjTarget };
}
