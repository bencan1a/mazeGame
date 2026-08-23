import { describe, expect, it } from 'vitest';
import type { Board } from '../types.js';
import { BoardInvariantError } from '../types.js';
import {
  ACYCLIC_BOARD,
  THREE_CYCLE_BOARD,
  TWO_CYCLE_BOARD,
  makeBoard,
} from '../../../test/fixtures/index.js';
import { isDirection, rayBlockers } from './rayBlockers.js';

describe('rayBlockers', () => {
  it('matches the blockers ACYCLIC_BOARD is built from', () => {
    // aaaa   a's ray south from (3,1) crosses c
    // bbBA   b's ray east from (2,1) hits a
    // bbcc   c's ray west from (0,3) leaves the board, meeting nothing
    // Cccc
    expect(rayBlockers(ACYCLIC_BOARD, 1)).toEqual([3]);
    expect(rayBlockers(ACYCLIC_BOARD, 2)).toEqual([1]);
    expect(rayBlockers(ACYCLIC_BOARD, 3)).toEqual([]);
  });

  it('closes the TWO_CYCLE_BOARD loop across the outside gap between the two heads', () => {
    expect(rayBlockers(TWO_CYCLE_BOARD, 1)).toEqual([2]);
    expect(rayBlockers(TWO_CYCLE_BOARD, 2)).toEqual([1]);
  });

  it('closes the THREE_CYCLE_BOARD loop', () => {
    expect(rayBlockers(THREE_CYCLE_BOARD, 1)).toEqual([2]);
    expect(rayBlockers(THREE_CYCLE_BOARD, 2)).toEqual([3]);
    expect(rayBlockers(THREE_CYCLE_BOARD, 3)).toEqual([1]);
  });

  it('de-duplicates a segment its ray crosses more than once, keeping first-encounter order', () => {
    // A.   a's ray south crosses b, then c, then b's own body twice more —
    // bb   b snakes down column 1 and back into column 0 below c, so a
    // Cb   straight ray down column 0 meets it three times but must report
    // bb   it once, at its first appearance (before c, not after).
    // B.
    const board = makeBoard({
      art: ['A.', 'bb', 'Cb', 'bb', 'B.'].join('\n'),
      dirs: { a: 'S', c: 'E' },
    });
    expect(rayBlockers(board, 1)).toEqual([2, 3]);
  });

  it('throws naming the segment when its direction is out of range, before walking', () => {
    // step() answers NO_CELL outside 0..3, so an unguarded walk would report
    // no blockers. This must throw before the first step instead.
    const segDir = Uint8Array.from(ACYCLIC_BOARD.segDir);
    segDir[0] = 200;
    const broken: Board = { ...ACYCLIC_BOARD, segDir };

    expect(() => rayBlockers(broken, 1)).toThrow(BoardInvariantError);
    expect(() => rayBlockers(broken, 1)).toThrow(/segment 1 has direction 200/);
  });
});

describe('isDirection', () => {
  it('accepts exactly 0..3', () => {
    expect([0, 1, 2, 3].every(isDirection)).toBe(true);
    expect([-1, 4, 200, 255, NaN].some(isDirection)).toBe(false);
  });
});
