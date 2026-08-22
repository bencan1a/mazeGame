/**
 * Local types for the coloring stage (S3, PRD §4.2 step 6).
 *
 * `AdjacencyGraph` is not part of the shared `src/core/types.ts` contract: it
 * is an intermediate structure private to this stage, built from a `Board`'s
 * `occupancy` and consumed only by `colorSegments`. It never crosses a stream
 * boundary the way `Board.segColor` does, so it does not need a
 * contract-change to exist.
 */

/**
 * Undirected adjacency between segments, in CSR form (ADR-0003).
 *
 * Symmetric: if `j` appears in the slice for segment `i`, `i` appears in the
 * slice for segment `j`. No self-loops (a segment's own body is not an
 * adjacency edge) and no duplicate targets within one slice (two segments
 * that share many cell boundaries are still one edge).
 */
export interface AdjacencyGraph {
  /** CSR offsets into adjTarget. Length segmentCount + 1. */
  readonly adjStart: Uint32Array;
  /** Flattened neighbour segment ids (1-based), grouped by adjStart. */
  readonly adjTarget: Uint32Array;
}
