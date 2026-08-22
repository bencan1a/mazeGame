/**
 * Board validation (S4, #13). See docs/CONTRACTS.md "validation" and
 * docs/METRICS.md for how `greedyClear`'s result feeds `BoardMetrics` (#15)
 * without a second graph walk.
 */

export { validateBoard } from './validateBoard.js';
export { assertDeterministic } from './determinism.js';
export { greedyClear } from './greedyClear.js';
export type { GreedyClearResult } from './greedyClear.js';
export { rayBlockers, isDirection } from './rayBlockers.js';
export { checkStructure } from './structure.js';
export { checkCoverage, MIN_COVERAGE } from './coverage.js';
export { checkEdgesMatchRays } from './edges.js';
