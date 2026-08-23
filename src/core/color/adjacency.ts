/**
 * Segment adjacency: an undirected edge whenever cells of two different
 * segments touch across a 4-neighbour boundary.
 *
 * Not the blocking digraph in `src/core/orient/`, which is directed ("must
 * this be removed before that"). Both are CSR `{start, target}` pairs and are
 * not interchangeable.
 */
import { EAST, NO_CELL, SOUTH, step, toIndex } from '../grid.js';
import type { AdjacencyGraph } from './types.js';

/**
 * Takes `occupancy` and dimensions rather than a `Board` so coloring builds and
 * tests without depending on the segmentation stream.
 */
export function buildAdjacencyGraph(
  occupancy: Uint16Array,
  width: number,
  height: number,
  segmentCount: number,
): AdjacencyGraph {
  // Validated up front rather than inside the scan below, which is too late: a
  // valid cell reaches an out-of-range *neighbour* before the scan arrives at
  // that neighbour's own cell.
  for (let i = 0; i < occupancy.length; i++) {
    const id = occupancy[i] as number;
    if (id > segmentCount) {
      throw new Error(
        `cell ${i} holds segment id ${id}, which is not a segment id (1..${segmentCount})`,
      );
    }
  }

  const neighbours: Set<number>[] = Array.from({ length: segmentCount + 1 }, () => new Set());

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = toIndex(x, y, width);
      const id = occupancy[i] as number;
      if (id === 0) continue;
      // East and South only: that visits every cell-to-cell contact once
      // instead of twice, and each contact records both endpoints below.
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
    // Sorted so the CSR slice is byte-identical run to run, not merely correct
    // as an unordered set (ADR-0004).
    const sorted = Array.from(neighbours[id] as Set<number>).sort((a, b) => a - b);
    for (const target of sorted) adjTarget[at++] = target;
  }
  adjStart[segmentCount] = at;

  return { adjStart, adjTarget };
}
