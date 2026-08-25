/**
 * Every inside cell should end up on some segment. `unvisited` cells are the
 * one exception, and must account for the whole shortfall rather than most of
 * it before the rest is written off as tolerable slop.
 *
 * Coverage is per region as well as board-wide: `regionOf` has to label
 * exactly the path cells, every region has to hold at least one, and every
 * labelled cell has to be covered. A board that drops a whole lobe of a
 * multi-lobe silhouette therefore fails naming the lobe, rather than passing
 * on a board-wide percentage the other lobes carry.
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
  const regionPathCells = new Uint32Array(mask.regionCount);

  for (let cell = 0; cell < size; cell++) {
    const occupied = (board.occupancy[cell] as number) !== 0;
    const inside = mask.inside[cell] === 1;
    const unvisited = mask.unvisited[cell] === 1;
    const region = mask.regionOf[cell] as number;

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
    }

    if (region > mask.regionCount) {
      throw new BoardInvariantError(
        `cell ${cell} is labelled region ${region}, outside 1..${mask.regionCount}`,
        { cell, region },
      );
    }
    if ((region !== 0) !== (inside && !unvisited)) {
      throw new BoardInvariantError(
        `cell ${cell} is labelled region ${region} but inside=${Number(inside)} ` +
          `unvisited=${Number(unvisited)}; regions label exactly the path cells`,
        { cell, region },
      );
    }
    if (region !== 0) regionPathCells[region - 1] = (regionPathCells[region - 1] as number) + 1;

    if (!occupied && region !== 0) {
      // Named individually rather than rolled into the percentage below:
      // "which cell, in which lobe" is what reproducing the gap needs, and a
      // board-wide percentage the other lobes carry would hide a whole lobe
      // going missing.
      throw new BoardInvariantError(
        `cell ${cell} of mask region ${region} is inside the mask, not covered by any segment, ` +
          'and not marked unvisited',
        { cell, region },
      );
    }

    if (inside) insideCount++;
  }

  for (let r = 0; r < mask.regionCount; r++) {
    if (regionPathCells[r] === 0) {
      throw new BoardInvariantError(`mask region ${r + 1} has no path cells`, { region: r + 1 });
    }
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
