/**
 * Every inside cell should end up on some segment. `unvisited` cells are the
 * one exception, and must account for the whole shortfall rather than most of
 * it before the rest is written off as tolerable slop.
 */

import type { Board, Mask } from '../types.js';
import { BoardInvariantError } from '../types.js';

/** Coverage below this fraction of inside cells fails validation. */
export const MIN_COVERAGE = 0.99;

export function checkCoverage(board: Board, mask: Mask): void {
  if (board.width !== mask.width || board.height !== mask.height) {
    throw new BoardInvariantError(
      `board is ${board.width}x${board.height}, mask is ${mask.width}x${mask.height}`,
      {
        board: { width: board.width, height: board.height },
        mask: { width: mask.width, height: mask.height },
      },
    );
  }

  const size = board.width * board.height;
  let insideCount = 0;
  let coveredCount = 0;

  for (let cell = 0; cell < size; cell++) {
    const occupied = (board.occupancy[cell] as number) !== 0;
    const inside = mask.inside[cell] === 1;
    const unvisited = mask.unvisited[cell] === 1;

    if (occupied) {
      coveredCount++;
      if (!inside) {
        throw new BoardInvariantError(`cell ${cell} is occupied but the mask marks it outside`, {
          cell,
        });
      }
      if (unvisited) {
        throw new BoardInvariantError(`cell ${cell} is occupied but the mask marks it unvisited`, {
          cell,
        });
      }
    } else if (inside && !unvisited) {
      // Named individually rather than rolled into the percentage below:
      // "which cell" is what reproducing the gap needs.
      throw new BoardInvariantError(
        `cell ${cell} is inside the mask, not covered by any segment, and not marked unvisited`,
        { cell },
      );
    }

    if (inside) insideCount++;
  }

  if (insideCount === 0) {
    throw new BoardInvariantError('mask has no inside cells to cover');
  }

  const coverage = coveredCount / insideCount;
  if (coverage < MIN_COVERAGE) {
    throw new BoardInvariantError(
      `coverage is ${(coverage * 100).toFixed(2)}% (${coveredCount}/${insideCount} inside cells), ` +
        `below the ${(MIN_COVERAGE * 100).toFixed(0)}% floor`,
      { coverage, covered: coveredCount, inside: insideCount },
    );
  }
}
