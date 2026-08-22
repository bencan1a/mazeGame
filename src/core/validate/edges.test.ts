import { describe, expect, it } from 'vitest';
import type { Board } from '../types.js';
import {
  ACYCLIC_BOARD,
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  THREE_CYCLE_BOARD,
  TWO_CYCLE_BOARD,
  makeBoard,
} from '../../../test/fixtures/index.js';
import { checkEdgesMatchRays } from './edges.js';

describe('checkEdgesMatchRays', () => {
  it.each([
    ['ACYCLIC_BOARD', ACYCLIC_BOARD],
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD],
  ])('accepts %s, whose edges were derived from these same rays', (_name, board: Board) => {
    expect(() => checkEdgesMatchRays(board)).not.toThrow();
  });

  it('rejects a declared blocker the ray does not actually hit', () => {
    const edgeTarget = Uint32Array.from(ACYCLIC_BOARD.edgeTarget);
    edgeTarget[0] = 2; // a really blocks on c (3), not b (2)
    const broken: Board = { ...ACYCLIC_BOARD, edgeTarget };

    expect(() => checkEdgesMatchRays(broken)).toThrow(/segment 1.*disagree with its exit ray/);
  });

  it('rejects a declared blocker with nothing missing — an extra blocker on its own', () => {
    // Keep a and b's real edges (a -> c, b -> a) intact and add one spurious
    // edge for c, which genuinely blocks on nothing: `extra` is non-empty
    // while `missing` stays empty, the other half of the disagreement message.
    const board = makeBoard({
      art: ACYCLIC_BOARD_ART,
      walks: ACYCLIC_BOARD_WALKS,
      edges: [
        [1, 3],
        [2, 1],
        [3, 1],
      ],
    });
    expect(() => checkEdgesMatchRays(board)).toThrow(/extra: \[1\]/);
  });

  it('rejects a missing blocker the ray does hit', () => {
    // Drop a's only edge entirely: edgeStart keeps segment 1 empty, so its
    // real blocker (c) is missing from what is declared.
    const edgeStart = Uint32Array.from(ACYCLIC_BOARD.edgeStart);
    for (let i = 1; i < edgeStart.length; i++) edgeStart[i] = (edgeStart[i] as number) - 1;
    const edgeTarget = ACYCLIC_BOARD.edgeTarget.slice(1);
    const broken: Board = { ...ACYCLIC_BOARD, edgeStart, edgeTarget };

    expect(() => checkEdgesMatchRays(broken)).toThrow(/missing: \[3\]/);
  });

  it('rejects a blocker id outside 1..n', () => {
    // The fixture builder itself refuses an out-of-range edge target, so this
    // has to be introduced by mutating an already-built board directly.
    const edgeTarget = Uint32Array.from(ACYCLIC_BOARD.edgeTarget);
    edgeTarget[0] = 99;
    const board: Board = { ...ACYCLIC_BOARD, edgeTarget };
    expect(() => checkEdgesMatchRays(board)).toThrow(/not a valid segment id/);
  });

  it('rejects a segment declared as its own blocker', () => {
    const board = makeBoard({
      art: ACYCLIC_BOARD_ART,
      walks: ACYCLIC_BOARD_WALKS,
      edges: [[1, 1]],
    });
    expect(() => checkEdgesMatchRays(board)).toThrow(/own cells never block it/);
  });

  it('rejects the same blocker declared twice', () => {
    const board = makeBoard({
      art: ACYCLIC_BOARD_ART,
      walks: ACYCLIC_BOARD_WALKS,
      edges: [
        [1, 3],
        [1, 3],
      ],
    });
    expect(() => checkEdgesMatchRays(board)).toThrow(/declares a blocker more than once/);
  });
});
