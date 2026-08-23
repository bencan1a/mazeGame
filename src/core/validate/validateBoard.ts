/**
 * Call order matters: each check assumes the previous one held, so a failure is
 * attributed to the earliest thing actually wrong rather than to a symptom.
 */

import type { Board, Mask } from '../types.js';
import { BoardInvariantError } from '../types.js';
import { checkCoverage } from './coverage.js';
import { checkEdgesMatchRays } from './edges.js';
import { greedyClear } from './greedyClear.js';
import { checkStructure } from './structure.js';

export function validateBoard(board: Board, mask: Mask): void {
  checkStructure(board);
  checkCoverage(board, mask);
  checkEdgesMatchRays(board);

  const clear = greedyClear(board);
  if (clear.stuck.length > 0) {
    const n = board.segmentCount;
    throw new BoardInvariantError(
      `board is unsolvable: ${clear.stuck.length} of ${n} segments never become free in a ` +
        `greedy clear (a topological sort of the blocking digraph does not consume all ${n} ` +
        `segments, so it has a cycle): stuck segments [${Array.from(clear.stuck).join(', ')}]`,
      { stuck: Array.from(clear.stuck), cleared: Array.from(clear.order) },
    );
  }
}
