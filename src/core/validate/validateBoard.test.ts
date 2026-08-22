import { describe, expect, it } from 'vitest';
import type { Board, Mask } from '../types.js';
import { BoardInvariantError } from '../types.js';
import {
  ACYCLIC_BOARD,
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  SQUARE_MASK,
  THREE_CYCLE_BOARD,
  TWO_CYCLE_BOARD,
  makeBoard,
  makeBoardAndMask,
  makeMask,
} from '../../../test/fixtures/index.js';
import { validateBoard } from './validateBoard.js';

// The cyclic fixtures are structurally sound in every other respect — same
// CSR, head, direction and colour invariants as ACYCLIC_BOARD — so a validator
// that rejected them for a structural reason would be passing the acyclicity
// check by accident. Getting the mask alongside them from one source is what
// stops the test from asserting a disagreement it introduced itself.
const { board: acyclicBoard, mask: acyclicMask } = makeBoardAndMask({
  art: ACYCLIC_BOARD_ART,
  walks: ACYCLIC_BOARD_WALKS,
});

describe('validateBoard', () => {
  it('accepts a board whose blocking digraph is acyclic', () => {
    expect(() => validateBoard(acyclicBoard, acyclicMask)).not.toThrow();
    // ACYCLIC_BOARD (with its explicit chord walks) is the same board.
    expect(() => validateBoard(ACYCLIC_BOARD, acyclicMask)).not.toThrow();
  });

  it.each([
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD, [1, 2]],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD, [1, 2, 3]],
  ])('rejects %s and names every stuck segment', (_name, board: Board, stuck: number[]) => {
    const mask = makeMask(renderArtOf(board));
    let error: unknown;
    try {
      validateBoard(board, mask);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BoardInvariantError);
    const invariantError = error as BoardInvariantError;
    expect(invariantError.message).toContain('unsolvable');
    expect((invariantError.detail as { stuck: number[] }).stuck.sort()).toEqual(stuck);
  });

  it('names the offending cell when occupancy disagrees with the segment CSR', () => {
    const occupancy = Uint16Array.from(acyclicBoard.occupancy);
    occupancy[0] = 2;
    const broken: Board = { ...acyclicBoard, occupancy };

    expect(() => validateBoard(broken, acyclicMask)).toThrow(/cell 0/);
  });

  it('names the segment when a segment is empty', () => {
    const segStart = Uint32Array.from(acyclicBoard.segStart);
    segStart[1] = segStart[0] as number;
    const broken: Board = { ...acyclicBoard, segStart };

    expect(() => validateBoard(broken, acyclicMask)).toThrow(/segment 1 is empty/);
  });

  it('names the segment when segDir disagrees with the terminal stroke', () => {
    const segDir = Uint8Array.from(acyclicBoard.segDir);
    segDir[0] = 0; // was 2 (south); a's terminal stroke is genuinely south
    const broken: Board = { ...acyclicBoard, segDir };

    expect(() => validateBoard(broken, acyclicMask)).toThrow(/terminal stroke/);
  });

  it('guards a corrupt segDir before walking a ray, rather than looping forever', () => {
    // #38: step() answers NaN (not NO_CELL) outside 0..3, so an unguarded ray
    // walk would never terminate. segDir is a Uint8Array, so 255 is a value it
    // can actually carry without a type error catching it first.
    const segDir = Uint8Array.from(acyclicBoard.segDir);
    segDir[0] = 255;
    const broken: Board = { ...acyclicBoard, segDir };

    expect(() => validateBoard(broken, acyclicMask)).toThrow(/not one of 0..3/);
  });

  it('names the segment when the declared blocking edges disagree with the exit ray', () => {
    const edgeTarget = Uint32Array.from(acyclicBoard.edgeTarget);
    edgeTarget[0] = 2; // a really blocks on c (3), not b (2)
    const broken: Board = { ...acyclicBoard, edgeTarget };

    expect(() => validateBoard(broken, acyclicMask)).toThrow(/disagree with its exit ray/);
  });

  it('rejects a declared self-blocking edge — a segment never blocks itself', () => {
    const board = makeBoard({
      art: ACYCLIC_BOARD_ART,
      walks: ACYCLIC_BOARD_WALKS,
      edges: [[1, 1]],
    });
    const { mask } = makeBoardAndMask({ art: ACYCLIC_BOARD_ART, walks: ACYCLIC_BOARD_WALKS });

    expect(() => validateBoard(board, mask)).toThrow(/own cells never block it/);
  });

  it('rejects a board and mask of different sizes', () => {
    const biggerMask = makeMask({ width: 5, height: 5 });
    expect(() => validateBoard(acyclicBoard, biggerMask)).toThrow(/board is .*mask is/);
  });

  it('accepts a same-size mask where every cell is inside (a plain rectangle)', () => {
    // SQUARE_MASK is a plain 4x4 rect; ACYCLIC_BOARD covers all 16 cells, so
    // the two agree completely.
    expect(() => validateBoard(acyclicBoard, SQUARE_MASK)).not.toThrow();
  });

  it('rejects a segment that claims a cell the mask marks outside', () => {
    // Cut one cell of ACYCLIC_BOARD's silhouette out of the mask while leaving
    // the board (and its coverage of that cell) untouched.
    const inside = Uint8Array.from(acyclicMask.inside);
    inside[0] = 0;
    const shrunkMask: Mask = { ...acyclicMask, inside };

    expect(() => validateBoard(acyclicBoard, shrunkMask)).toThrow(
      /occupied but the mask marks it outside/,
    );
  });
});

/** Rebuild the ASCII art a fixture board's occupancy describes, for makeBoardAndMask's mask half. */
function renderArtOf(board: Board): string {
  const rows: string[] = [];
  for (let y = 0; y < board.height; y++) {
    let row = '';
    for (let x = 0; x < board.width; x++) {
      row += board.occupancy[y * board.width + x] === 0 ? '.' : '#';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
