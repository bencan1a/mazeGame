export type { ContourFailed, ContourOk, ContourResult } from './contour.js';
export { buildContourPath } from './contour.js';
export type { TilingFailed, TilingOk, TilingResult } from './tiling.js';
export { classifyTiling } from './tiling.js';
export type { BackbiteFailed, BackbiteOk, BackbiteOptions, BackbiteResult } from './backbite.js';
export {
  buildBackbitePath,
  DEFAULT_MAX_GROWTH_MOVES_PER_CELL,
  DEFAULT_MIXING_MOVES_PER_CELL,
  DEFAULT_STALL_LIMIT_PER_CELL,
} from './backbite.js';
