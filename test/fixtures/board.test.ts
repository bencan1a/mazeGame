import { describe, expect, it } from 'vitest';
import type { Board } from '../../src/core/types.js';
import {
  ACYCLIC_BOARD,
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  THREE_CYCLE_BOARD,
  TWO_CYCLE_BOARD,
  makeBoard,
  makeBoardAndMask,
} from './board.js';
import { renderMask } from './mask.js';
import {
  blockersOf,
  boardMaskViolations,
  boardStructureViolations,
  greedyClearOrder,
  isAcyclic,
} from './postconditions.js';

describe('ACYCLIC_BOARD', () => {
  // aaaa   a runs along the top and turns down the right edge
  // bbBA   b turns up out of the middle, exits east into a
  // bbcc   c wraps the bottom, exits west off the board
  // Cccc
  it('numbers segments by first appearance in a row-major scan', () => {
    expect(ACYCLIC_BOARD.segmentCount).toBe(3);
    expect(Array.from(ACYCLIC_BOARD.occupancy)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 1, 2, 2, 3, 3, 3, 3, 3, 3,
    ]);
  });

  it('lays the segments out tail -> head in CSR', () => {
    expect(Array.from(ACYCLIC_BOARD.segStart)).toEqual([0, 5, 10, 16]);
    expect(Array.from(ACYCLIC_BOARD.segCells)).toEqual([
      0,
      1,
      2,
      3,
      7, // a: (0,0) east along the top, then south to (3,1)
      9,
      8,
      4,
      5,
      6, // b: (1,2) west, north, then east to (2,1)
      10,
      11,
      15,
      14,
      13,
      12, // c: (2,2) east, south, then west to (0,3)
    ]);
  });

  it('puts the head last and reads segDir off the terminal stroke', () => {
    expect(Array.from(ACYCLIC_BOARD.segHead)).toEqual([7, 6, 12]);
    expect(Array.from(ACYCLIC_BOARD.segDir)).toEqual([2, 1, 3]); // S, E, W
  });

  it('has the blocking edges the exit rays imply', () => {
    // Written out independently of the ray-caster: a's ray south from (3,1)
    // crosses c; b's ray east from (2,1) hits a; c's ray west from (0,3) leaves
    // the board without meeting anything.
    expect(blockersOf(ACYCLIC_BOARD, 1)).toEqual([3]);
    expect(blockersOf(ACYCLIC_BOARD, 2)).toEqual([1]);
    expect(blockersOf(ACYCLIC_BOARD, 3)).toEqual([]);
    expect(Array.from(ACYCLIC_BOARD.edgeStart)).toEqual([0, 1, 2, 2]);
    expect(Array.from(ACYCLIC_BOARD.edgeTarget)).toEqual([3, 1]);
  });

  it('clears in the one order its digraph allows', () => {
    expect(isAcyclic(ACYCLIC_BOARD)).toBe(true);
    expect(greedyClearOrder(ACYCLIC_BOARD)).toEqual([3, 1, 2]);
  });
});

describe('cyclic boards', () => {
  it('TWO_CYCLE_BOARD has two segments aimed at each other', () => {
    // aA.Bb  the gap at (2,0) is on both rays, and blocks neither
    // Ccccc
    expect(blockersOf(TWO_CYCLE_BOARD, 1)).toEqual([2]);
    expect(blockersOf(TWO_CYCLE_BOARD, 2)).toEqual([1]);
    expect(blockersOf(TWO_CYCLE_BOARD, 3)).toEqual([]);
  });

  it('THREE_CYCLE_BOARD closes a 1 -> 2 -> 3 -> 1 loop', () => {
    expect(Array.from(THREE_CYCLE_BOARD.edgeTarget)).toEqual([2, 3, 1]);
  });

  it.each([
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD],
  ])('%s stalls a greedy clear', (_name, board: Board) => {
    expect(isAcyclic(board)).toBe(false);
    expect(greedyClearOrder(board)).toBeNull();
  });

  it.each([
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD],
  ])('%s is otherwise structurally sound, so only the cycle fails', (_name, board: Board) => {
    // If the cyclic fixtures were malformed as well, a validator could pass
    // them for the wrong reason and still look correct.
    expect(boardStructureViolations(board)).toEqual([]);
  });
});

describe('board postconditions', () => {
  it.each([
    ['ACYCLIC_BOARD', ACYCLIC_BOARD],
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD],
  ])('%s satisfies the CSR, head, direction, edge and colour contracts', (_name, board: Board) => {
    expect(boardStructureViolations(board)).toEqual([]);
  });

  it('catches occupancy that disagrees with the segment lists', () => {
    const broken: Board = {
      ...ACYCLIC_BOARD,
      occupancy: Uint16Array.from(ACYCLIC_BOARD.occupancy),
    };
    broken.occupancy[0] = 2;

    expect(boardStructureViolations(broken)).toContainEqual(
      expect.stringContaining('segment 1 claims cell 0 but occupancy says 2'),
    );
  });

  it('catches a segDir that is not the terminal stroke', () => {
    const segDir = Uint8Array.from(ACYCLIC_BOARD.segDir);
    segDir[0] = 0;

    expect(boardStructureViolations({ ...ACYCLIC_BOARD, segDir })).toContainEqual(
      expect.stringContaining('segment 1 exits 0 but its terminal stroke is 2'),
    );
  });

  it('catches blocking edges that the geometry does not support', () => {
    const board = makeBoard({
      art: ACYCLIC_BOARD_ART,
      walks: ACYCLIC_BOARD_WALKS,
      edges: [[1, 2]],
    });

    expect(boardStructureViolations(board)).toContainEqual(
      expect.stringContaining('segment 1 blockers are [2], the ray hits [3]'),
    );
  });

  it('catches touching segments that share a hue', () => {
    const segColor = Uint8Array.from(ACYCLIC_BOARD.segColor).fill(0);

    expect(boardStructureViolations({ ...ACYCLIC_BOARD, segColor })).toContainEqual(
      expect.stringContaining('share colour 0'),
    );
  });
});

describe('makeBoardAndMask', () => {
  it('derives a mask that covers exactly the occupied cells', () => {
    const { board, mask } = makeBoardAndMask({
      art: ACYCLIC_BOARD_ART,
      walks: ACYCLIC_BOARD_WALKS,
    });

    expect(renderMask(mask)).toBe(['####', '####', '####', '####'].join('\n'));
    expect(boardMaskViolations(board, mask)).toEqual([]);
  });

  it('keeps unvisited cells inside the mask but off the board', () => {
    const { board, mask } = makeBoardAndMask('aaAo');

    expect(renderMask(mask)).toBe('###o');
    expect(mask.pathCellCount).toBe(3);
    expect(board.occupancy[3]).toBe(0);
    expect(boardMaskViolations(board, mask)).toEqual([]);
  });

  it('catches a board and mask that disagree', () => {
    const { board } = makeBoardAndMask('aaAo');
    const { mask } = makeBoardAndMask('aaaA');

    expect(boardMaskViolations(board, mask)).toContainEqual(
      expect.stringContaining('3 covered cells, mask.pathCellCount is 4'),
    );
  });
});

describe('makeBoard spec errors', () => {
  it('asks for the walk when a segment has a chord', () => {
    // b touches itself: (1,1) is beside (1,2), but they are not consecutive.
    expect(() => makeBoard(ACYCLIC_BOARD_ART)).toThrow(
      /segment "b" is ambiguous at cell 5.*walks: \{ b: 'ESW' \}/s,
    );
  });

  it('rejects a walk of the wrong length', () => {
    expect(() => makeBoard({ art: ACYCLIC_BOARD_ART, walks: { b: 'WNE', c: 'ESWWW' } })).toThrow(
      /walks.b has 3 step\(s\) for a 5-cell segment/,
    );
  });

  it('rejects a walk that leaves the segment', () => {
    expect(() => makeBoard({ art: ACYCLIC_BOARD_ART, walks: { b: 'WNEN', c: 'ESWWW' } })).toThrow(
      /walks.b step 3 leaves the segment/,
    );
  });

  it('rejects an unknown direction in a walk', () => {
    expect(() => makeBoard({ art: ACYCLIC_BOARD_ART, walks: { b: 'WNEX', c: 'ESWWW' } })).toThrow(
      /unknown direction/,
    );
  });

  it('rejects a segment with no head', () => {
    expect(() => makeBoard('aa.Bb')).toThrow(/segment "a" has no head/);
  });

  it('rejects a segment with two heads', () => {
    expect(() => makeBoard('AA.Bb')).toThrow(/segment "a" has two heads/);
  });

  it('rejects a head marked anywhere but an endpoint', () => {
    expect(() => makeBoard('aAa')).toThrow(/segment "a" is ambiguous at cell 1/);
  });

  it('rejects a segment that is not a path at all', () => {
    expect(() => makeBoard(['.a.', 'aAa', '.a.'].join('\n'))).toThrow(/ambiguous at cell 4/);
  });

  it('rejects a segment whose cells are in two pieces', () => {
    expect(() => makeBoard('aA.a')).toThrow(/walked 2 of 3 cells/);
  });

  it('reserves the unvisited marker, which is also a letter', () => {
    expect(() => makeBoard('aAO')).toThrow(/cannot use "O" as a segment/);
  });

  it('rejects a picture with no segments', () => {
    expect(() => makeBoard('...')).toThrow(/no segments/);
  });

  it('rejects an unknown character', () => {
    expect(() => makeBoard('aA#')).toThrow(/unknown character/);
  });

  it('asks for a direction on a single-cell segment, which has no stroke', () => {
    expect(() => makeBoard('A.Bb')).toThrow(/segment "a" is a single cell/);
  });

  it('takes the direction of a single-cell segment from the spec', () => {
    const board = makeBoard({ art: 'A.Bb', dirs: { a: 'E' } });

    expect(Array.from(board.segDir)).toEqual([1, 3]);
    expect(blockersOf(board, 1)).toEqual([2]);
    expect(boardStructureViolations(board)).toEqual([]);
  });

  it('refuses a direction that contradicts the picture', () => {
    expect(() => makeBoard({ art: 'aA.Bb', dirs: { a: 'N' } })).toThrow(
      /exits along its terminal stroke, which the picture says is E, not N/,
    );
  });
});

describe('board params', () => {
  it('defaults gridSize to the longer edge and takes overrides', () => {
    const board = makeBoard({ art: 'aA.Bb', params: { seed: 42 } });

    expect(board.params.gridSize).toBe(5);
    expect(board.params.seed).toBe(42);
  });
});
