/** Public surface of the coloring stage (S3). See docs/CONTRACTS.md "coloring". */
export { buildAdjacencyGraph } from './adjacency.js';
export { ColoringError, DEFAULT_PALETTE_SIZE, colorSegments } from './colorSegments.js';
export type { AdjacencyGraph } from './types.js';
