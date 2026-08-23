import type { AdjacencyGraph } from './types.js';

export const DEFAULT_PALETTE_SIZE = 6;

/** Colours come back in a Uint8Array, so 255 is the largest index that fits. */
export const MAX_PALETTE_SIZE = 256;

export class ColoringError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ColoringError';
  }
}

/**
 * Assigns each segment a palette index in `[0, paletteSize)` such that no two
 * adjacent segments share one.
 */
export function colorSegments(
  adjacency: AdjacencyGraph,
  segmentCount: number,
  paletteSize: number = DEFAULT_PALETTE_SIZE,
): Uint8Array {
  // A colour index has to fit the Uint8Array this returns; above 256 it wraps
  // modulo 256 and can hand two touching segments the same hue.
  if (!Number.isInteger(paletteSize) || paletteSize < 1 || paletteSize > MAX_PALETTE_SIZE) {
    throw new ColoringError(
      `paletteSize must be an integer in 1..${MAX_PALETTE_SIZE}, got ${paletteSize}`,
    );
  }
  assertWellFormed(adjacency, segmentCount);
  if (segmentCount === 0) return new Uint8Array(0);

  const order = smallestLastOrder(adjacency, segmentCount);
  const colors = new Uint8Array(segmentCount);
  const assigned = new Uint8Array(segmentCount); // 0/1 flag; id 0 is itself a legitimate colour

  for (let k = order.length - 1; k >= 0; k--) {
    const id = order[k] as number;
    const start = adjacency.adjStart[id - 1] as number;
    const end = adjacency.adjStart[id] as number;
    const taken = new Set<number>();
    for (let e = start; e < end; e++) {
      const neighbour = adjacency.adjTarget[e] as number;
      if (assigned[neighbour - 1] === 1) taken.add(colors[neighbour - 1] as number);
    }
    let color = 0;
    while (taken.has(color)) color++;
    if (color >= paletteSize) {
      throw new ColoringError(
        `segment ${id} needs hue ${color}, but the palette only holds ${paletteSize}`,
        { id, color, paletteSize },
      );
    }
    colors[id - 1] = color;
    assigned[id - 1] = 1;
  }

  return colors;
}

function smallestLastOrder(adjacency: AdjacencyGraph, segmentCount: number): Uint32Array {
  const { adjStart, adjTarget } = adjacency;
  const degree = new Uint32Array(segmentCount);
  for (let v = 0; v < segmentCount; v++) {
    degree[v] = (adjStart[v + 1] as number) - (adjStart[v] as number);
  }
  const removed = new Uint8Array(segmentCount);
  const order = new Uint32Array(segmentCount);

  for (let filled = 0; filled < segmentCount; filled++) {
    let best = -1;
    for (let v = 0; v < segmentCount; v++) {
      if (removed[v] === 1) continue;
      if (best === -1 || (degree[v] as number) < (degree[best] as number)) best = v;
    }
    order[filled] = best + 1;
    removed[best] = 1;
    for (let e = adjStart[best] as number; e < (adjStart[best + 1] as number); e++) {
      const neighbourIndex = (adjTarget[e] as number) - 1;
      if (removed[neighbourIndex] === 0) {
        degree[neighbourIndex] = (degree[neighbourIndex] as number) - 1;
      }
    }
  }

  return order;
}

function assertWellFormed(adjacency: AdjacencyGraph, segmentCount: number): void {
  const { adjStart, adjTarget } = adjacency;
  if (adjStart.length !== segmentCount + 1) {
    throw new ColoringError(
      `adjacency.adjStart has ${adjStart.length} entries, expected ${segmentCount + 1}`,
    );
  }
  if (segmentCount === 0) return;
  if (adjStart[0] !== 0) {
    throw new ColoringError(`adjacency.adjStart[0] is ${adjStart[0] as number}, expected 0`);
  }
  if (adjStart[segmentCount] !== adjTarget.length) {
    throw new ColoringError(
      `adjacency.adjStart[${segmentCount}] is ${adjStart[segmentCount] as number}, ` +
        `but adjTarget has ${adjTarget.length} entries`,
    );
  }

  const edges = new Set<number>();
  for (let id = 1; id <= segmentCount; id++) {
    const start = adjStart[id - 1] as number;
    const end = adjStart[id] as number;
    if (end < start) {
      throw new ColoringError(`adjacency.adjStart decreases at segment ${id}: ${start} -> ${end}`);
    }
    for (let e = start; e < end; e++) {
      const neighbour = adjTarget[e] as number;
      if (neighbour < 1 || neighbour > segmentCount) {
        throw new ColoringError(
          `segment ${id} is adjacent to ${neighbour}, which is not a segment id (1..${segmentCount})`,
        );
      }
      if (neighbour === id) {
        throw new ColoringError(`segment ${id} is adjacent to itself`);
      }
      const edge = id * (segmentCount + 1) + neighbour;
      // A duplicate would double-decrement `degree` in smallestLastOrder.
      if (edges.has(edge)) {
        throw new ColoringError(`segment ${id} lists segment ${neighbour} more than once`);
      }
      edges.add(edge);
    }
  }

  for (const edge of edges) {
    const id = Math.floor(edge / (segmentCount + 1));
    const neighbour = edge % (segmentCount + 1);
    if (!edges.has(neighbour * (segmentCount + 1) + id)) {
      throw new ColoringError(
        `adjacency is not symmetric: ${id} lists ${neighbour}, but ${neighbour} does not list ${id}`,
      );
    }
  }
}
