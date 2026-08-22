/**
 * Synthetic masks, paths and boards.
 *
 * This is the mechanism that lets the streams run in parallel: every stage is
 * developed against a synthetic version of its own input instead of waiting for
 * the stage upstream of it.
 */

export { fromRows, toRows } from './art.js';
export {
  INSIDE_CHAR,
  OUTSIDE_CHAR,
  PLUS_MASK,
  SQUARE_MASK,
  UNVISITED_CHAR,
  UNVISITED_MASK,
  makeMask,
  renderMask,
} from './mask.js';
export type { MaskSpec, RectSpec } from './mask.js';
export { makePath, makePathFromCells, pathDirections } from './path.js';
export {
  ACYCLIC_BOARD,
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  PALETTE_SIZE,
  THREE_CYCLE_BOARD,
  THREE_CYCLE_BOARD_ART,
  TWO_CYCLE_BOARD,
  TWO_CYCLE_BOARD_ART,
  makeBoard,
  makeBoardAndMask,
} from './board.js';
export type { BoardSpec, BoardSpecLike } from './board.js';
export {
  blockersOf,
  boardMaskViolations,
  boardStructureViolations,
  greedyClearOrder,
  isAcyclic,
  maskViolations,
  pathViolations,
  rayBlockers,
} from './postconditions.js';
