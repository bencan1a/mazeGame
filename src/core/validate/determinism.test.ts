import { describe, expect, it } from 'vitest';
import type { Board } from '../types.js';
import { BoardInvariantError } from '../types.js';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../../test/fixtures/index.js';
import { assertDeterministic } from './determinism.js';

/**
 * `generateBoard` (#14) is out of this stream's scope and does not exist yet.
 * These tests exercise the comparison half honestly: `assertDeterministic`
 * itself, on two boards, rather than pretending to wire up a generator that
 * is not there. Once #14 lands, it is expected to call this as
 * `assertDeterministic(generateBoard(params), generateBoard(params))`.
 */
describe('assertDeterministic', () => {
  it('accepts two structurally-equal boards, including a fresh clone of every array', () => {
    const clone: Board = {
      ...ACYCLIC_BOARD,
      params: { ...ACYCLIC_BOARD.params },
      occupancy: Uint16Array.from(ACYCLIC_BOARD.occupancy),
      segStart: Uint32Array.from(ACYCLIC_BOARD.segStart),
      segCells: Uint32Array.from(ACYCLIC_BOARD.segCells),
      segHead: Uint32Array.from(ACYCLIC_BOARD.segHead),
      segDir: Uint8Array.from(ACYCLIC_BOARD.segDir),
      edgeStart: Uint32Array.from(ACYCLIC_BOARD.edgeStart),
      edgeTarget: Uint32Array.from(ACYCLIC_BOARD.edgeTarget),
      segColor: Uint8Array.from(ACYCLIC_BOARD.segColor),
    };
    expect(() => assertDeterministic(ACYCLIC_BOARD, clone)).not.toThrow();
  });

  it('rejects boards of different size', () => {
    const board: Board = { ...ACYCLIC_BOARD, width: 5 };
    expect(() => assertDeterministic(ACYCLIC_BOARD, board)).toThrow(/size/);
  });

  it('rejects boards with a different segmentCount', () => {
    const board: Board = { ...ACYCLIC_BOARD, segmentCount: 2 };
    expect(() => assertDeterministic(ACYCLIC_BOARD, board)).toThrow(/segmentCount/);
  });

  it('names the differing params field', () => {
    const board: Board = { ...ACYCLIC_BOARD, params: { ...ACYCLIC_BOARD.params, seed: 999 } };
    expect(() => assertDeterministic(ACYCLIC_BOARD, board)).toThrow(/params\.seed/);
  });

  it('names the array field when its length itself differs', () => {
    const board: Board = { ...ACYCLIC_BOARD, edgeTarget: ACYCLIC_BOARD.edgeTarget.slice(0, 1) };
    expect(() => assertDeterministic(ACYCLIC_BOARD, board)).toThrow(
      /edgeTarget has 2 entries vs 1/,
    );
  });

  it('names the array field and index of the first difference', () => {
    const occupancy = Uint16Array.from(ACYCLIC_BOARD.occupancy);
    occupancy[5] = 3;
    const board: Board = { ...ACYCLIC_BOARD, occupancy };

    let error: unknown;
    try {
      assertDeterministic(ACYCLIC_BOARD, board);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BoardInvariantError);
    expect((error as BoardInvariantError).message).toMatch(/occupancy\[5\]/);
  });

  it.each([
    ['ACYCLIC_BOARD', ACYCLIC_BOARD],
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD],
  ])('%s is deterministic against itself', (_name, board: Board) => {
    expect(() => assertDeterministic(board, board)).not.toThrow();
  });
});
