/**
 * The validation gate (CONTRACTS.md "validation", PRD §4.2 step 5): a board
 * that has passed this function is the one guarantee PoC goal 1 rests on —
 * never ship an unsolvable board. Runs every check, every time, in dev and in
 * tests; throws `BoardInvariantError` naming the offending segment or cell
 * rather than a bare "invalid board", because the next agent debugging a
 * generator bug needs a place to start looking.
 *
 * Call order matters: each stage assumes the previous one held, so a failure
 * is attributed to the earliest thing actually wrong rather than a symptom.
 *
 * Determinism (the fifth CONTRACTS.md check) is deliberately not here — see
 * determinism.ts for why the signature below cannot carry it.
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
