export interface AdjacencyGraph {
  /** CSR offsets into adjTarget. Length segmentCount + 1. */
  readonly adjStart: Uint32Array;
  /** Flattened neighbour segment ids, 1-based, grouped by adjStart. */
  readonly adjTarget: Uint32Array;
}
