/**
 * Local types for the coloring stage (S3, PRD §4.2 step 6).
 *
 * `AdjacencyGraph` is private to this stage and never crosses a stream
 * boundary the way `Board.segColor` does, so changing it needs no
 * contract-change issue.
 */

/**
 * Undirected adjacency between segments, in CSR form (ADR-0003).
 *
 * Symmetric, no self-loops, and no duplicate targets within one slice — two
 * segments sharing many cell boundaries are still one edge. `colorSegments`
 * enforces all three.
 */
export interface AdjacencyGraph {
  /** CSR offsets into adjTarget. Length segmentCount + 1. */
  readonly adjStart: Uint32Array;
  /** Flattened neighbour segment ids (1-based), grouped by adjStart. */
  readonly adjTarget: Uint32Array;
}
