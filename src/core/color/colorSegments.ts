/**
 * Greedy graph coloring over the segment adjacency graph (PRD §3.3, §4.2
 * step 6).
 *
 * Colours here are palette *indices*, not colours: the palette itself (which
 * RGB a hue index maps to) is a render concern that lives in `src/render/`.
 * `src/core` is a pure function of its inputs and has no notion of what a hue
 * looks like on screen — emitting an index rather than a colour is what keeps
 * that boundary real rather than aspirational.
 *
 * Ordering matters for how many hues greedy coloring needs. A segment
 * adjacency graph built from a tiling of the grid is planar — segments are
 * simply-connected regions of a plane, so the region-adjacency graph never
 * has a crossing — and every planar graph has degeneracy <= 5: there is
 * always some order to peel vertices off in where each one has at most 5
 * *still-present* neighbours at the moment it is peeled. Colouring in the
 * reverse of that peeling order (the classic "smallest-last" ordering) is
 * therefore guaranteed to need at most 6 colours for any real board's
 * adjacency graph. That is where the PRD's "4-6 hues" comes from — it is not
 * an arbitrary choice, it is the planar degeneracy bound.
 *
 * A hand-built or malformed adjacency graph can still exceed that (a complete
 * graph on 7 segments, for instance, is not planar and cannot arise from a
 * real grid tiling). When it does, this throws rather than reusing a hue
 * silently: a reused hue is invisible in a screenshot and only shows up as
 * "I can't tell these two pieces apart" from a player, which is exactly the
 * failure this stage exists to prevent.
 */
import type { AdjacencyGraph } from './types.js';

/** Number of palette hues the render layer promises (PRD §3.3: 4-6). */
export const DEFAULT_PALETTE_SIZE = 6;

/** Colours are returned in a Uint8Array, so the largest index that fits is 255. */
export const MAX_PALETTE_SIZE = 256;

/** Thrown when the palette genuinely cannot cover the adjacency graph. */
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
 * adjacent segments (per `adjacency`) share one.
 *
 * `adjacency` must be well formed: CSR offsets of length `segmentCount + 1`,
 * starting at 0, non-decreasing, ending at `adjTarget.length`; every target a
 * valid 1-based id; no self-loops; symmetric. `buildAdjacencyGraph` produces
 * exactly that. It is checked rather than assumed, because a malformed graph
 * would otherwise produce a colouring that silently violates the readability
 * property this function exists to guarantee - and the caller would have no
 * way to tell a good colouring from a meaningless one.
 */
export function colorSegments(
  adjacency: AdjacencyGraph,
  segmentCount: number,
  paletteSize: number = DEFAULT_PALETTE_SIZE,
): Uint8Array {
  // A colour index has to fit the Uint8Array this returns. Without this guard a
  // paletteSize above 256 lets the greedy search pick 256+, which wraps modulo
  // 256 on assignment and can hand two touching segments the same hue - a
  // silent failure of the exact property this function exists to guarantee.
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

  // Colour in the *reverse* of the peeling order: the vertex removed last —
  // the one with the most neighbours still standing once everything else is
  // gone — is coloured first, which is what makes the degeneracy bound apply.
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
 * Smallest-last (degeneracy) vertex ordering: repeatedly remove the
 * currently-lowest-degree vertex and record the order it was removed in.
 *
 * `segmentCount` on a real board is at most a few thousand (a 100x100 grid at
 * the smallest allowed piece length), so the O(n^2) scan for the minimum
 * remaining degree stays well inside the generator's 1s budget and is far
 * easier to verify than a bucket-queue peeling structure would be.
 */
function smallestLastOrder(adjacency: AdjacencyGraph, segmentCount: number): Uint32Array {
  const neighborsOf: number[][] = Array.from({ length: segmentCount }, (_, i) => {
    const start = adjacency.adjStart[i] as number;
    const end = adjacency.adjStart[i + 1] as number;
    return Array.from(adjacency.adjTarget.slice(start, end));
  });
  const degree: number[] = neighborsOf.map((list) => list.length);
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
    for (const neighbourId of neighborsOf[best] as number[]) {
      const neighbourIndex = neighbourId - 1;
      if (removed[neighbourIndex] === 0) {
        degree[neighbourIndex] = (degree[neighbourIndex] as number) - 1;
      }
    }
  }

  return order;
}

/**
 * The checks the doc comment above promises. Linear in the number of edges, run
 * once per board, so the cost is not worth trading for the failure mode.
 */
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
      edges.add(id * (segmentCount + 1) + neighbour);
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
