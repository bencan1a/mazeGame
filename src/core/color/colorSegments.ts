/**
 * Greedy graph coloring over the segment adjacency graph (PRD §3.3, §4.2
 * step 6).
 *
 * Emits palette *indices*, not colours: which RGB a hue maps to is a render
 * concern, and `src/core` has no notion of what a hue looks like (ADR-0004).
 *
 * The PRD's "4-6 hues" is the planar degeneracy bound, not a taste call. A
 * segment adjacency graph built from a tiling of the plane is planar, every
 * planar graph has degeneracy <= 5, and colouring in reverse smallest-last
 * order therefore never needs more than 6 hues on a real board. A hand-built
 * or malformed graph can still exceed it; that throws rather than reusing a
 * hue, because a reused hue only ever surfaces as a player who cannot tell
 * two pieces apart.
 */
import type { AdjacencyGraph } from './types.js';

/** Number of palette hues the render layer promises (PRD §3.3: 4-6). */
export const DEFAULT_PALETTE_SIZE = 6;

/** Colours are returned in a Uint8Array, so the largest index that fits is 255. */
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
 *
 * `adjacency` is checked rather than trusted: a malformed graph produces a
 * colouring that violates that property silently, and the caller has no way to
 * tell it from a good one.
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

  // Reverse of the peeling order — last removed is coloured first — is what
  // makes the degeneracy bound apply.
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

/**
 * Smallest-last (degeneracy) ordering: repeatedly remove the
 * currently-lowest-degree vertex and record the order removed in.
 *
 * `segmentCount` on a real board is at most a few thousand, so the O(n^2) scan
 * for the minimum remaining degree stays well inside the generator's 1s budget
 * and is far easier to verify than a bucket-queue peeling structure.
 */
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
      // A duplicate double-decrements `degree` in smallestLastOrder, breaking
      // the degeneracy ordering the <= 6 bound rests on.
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
