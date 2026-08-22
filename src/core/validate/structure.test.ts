import { describe, expect, it } from 'vitest';
import type { Board } from '../types.js';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../../test/fixtures/index.js';
import { checkStructure } from './structure.js';

describe('checkStructure', () => {
  it.each([
    ['ACYCLIC_BOARD', ACYCLIC_BOARD],
    ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD],
    ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD],
  ])(
    'accepts %s — structurally sound regardless of its blocking digraph',
    (_name, board: Board) => {
      expect(() => checkStructure(board)).not.toThrow();
    },
  );

  it('rejects a board with zero segments', () => {
    const board: Board = { ...ACYCLIC_BOARD, segmentCount: 0 };
    expect(() => checkStructure(board)).toThrow(/0 segments/);
  });

  it('names the array whose length disagrees with segmentCount', () => {
    const board: Board = { ...ACYCLIC_BOARD, segHead: new Uint32Array(2) };
    expect(() => checkStructure(board)).toThrow(/segHead has 2 entries, expected 3/);
  });

  it.each([
    ['occupancy', { occupancy: new Uint16Array(1) }, /occupancy has 1 cells, expected 16/],
    ['segStart', { segStart: new Uint32Array(2) }, /segStart has 2 entries, expected 4/],
    ['segDir', { segDir: new Uint8Array(1) }, /segDir has 1 entries, expected 3/],
    ['segColor', { segColor: new Uint8Array(1) }, /segColor has 1 entries, expected 3/],
    ['edgeStart', { edgeStart: new Uint32Array(1) }, /edgeStart has 1 entries, expected 4/],
  ])('names %s when its length disagrees with the board shape', (_field, patch, expected) => {
    expect(() => checkStructure({ ...ACYCLIC_BOARD, ...patch })).toThrow(expected);
  });

  it('rejects an edgeStart[0] that is not 0', () => {
    const edgeStart = Uint32Array.from(ACYCLIC_BOARD.edgeStart);
    edgeStart[0] = 1;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, edgeStart })).toThrow(/edgeStart\[0\] is 1/);
  });

  it('rejects an edgeStart[n] that disagrees with edgeTarget length', () => {
    const edgeStart = Uint32Array.from(ACYCLIC_BOARD.edgeStart);
    edgeStart[edgeStart.length - 1] = 99;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, edgeStart })).toThrow(
      /edgeTarget has 2 entries/,
    );
  });

  it('rejects a segStart that is not non-decreasing', () => {
    const segStart = Uint32Array.from(ACYCLIC_BOARD.segStart);
    segStart[2] = 2; // was 10; now less than segStart[1] = 5
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segStart })).toThrow(
      /segStart is not non-decreasing at segment 2/,
    );
  });

  it('rejects an edgeStart that is not non-decreasing', () => {
    const edgeStart = Uint32Array.from(ACYCLIC_BOARD.edgeStart);
    edgeStart[1] = 5; // was 1; now greater than edgeStart[2] = 2
    expect(() => checkStructure({ ...ACYCLIC_BOARD, edgeStart })).toThrow(
      /edgeStart is not non-decreasing at segment 2/,
    );
  });

  it('rejects a segStart[0] that is not 0', () => {
    const segStart = Uint32Array.from(ACYCLIC_BOARD.segStart);
    segStart[0] = 1;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segStart })).toThrow(/segStart\[0\] is 1/);
  });

  it('rejects a segStart[n] that disagrees with segCells length', () => {
    const segStart = Uint32Array.from(ACYCLIC_BOARD.segStart);
    segStart[3] = 99;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segStart })).toThrow(/segCells has 16 entries/);
  });

  it('names the cell when occupancy holds an id above segmentCount', () => {
    const occupancy = Uint16Array.from(ACYCLIC_BOARD.occupancy);
    occupancy[0] = 7;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, occupancy })).toThrow(
      /cell 0 occupancy is 7, which is not a valid segment id/,
    );
  });

  it('names the segment when its cell list holds a cell index outside the grid', () => {
    const segCells = Uint32Array.from(ACYCLIC_BOARD.segCells);
    segCells[0] = 999;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segCells })).toThrow(
      /segment 1 lists cell 999, outside the 16-cell grid/,
    );
  });

  it('names the segment when its cell list is not a connected walk', () => {
    // Segment 1 (a) is cells [0, 1, 2, 3, 7]; swap the last two so the walk
    // jumps straight from 2 to 7 (not 4-neighbours) — the swapped cells are
    // still both a's per occupancy either way, so this isolates the
    // walk-connectivity check from the occupancy-agreement one.
    const segCells = Uint32Array.from(ACYCLIC_BOARD.segCells);
    segCells[3] = 7;
    segCells[4] = 3;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segCells })).toThrow(/not a connected walk/);
  });

  it('names the segment when its recorded head is not its last cell', () => {
    const segHead = Uint32Array.from(ACYCLIC_BOARD.segHead);
    segHead[0] = 0;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segHead })).toThrow(
      /segment 1 head is recorded as 0, but its last cell is 7/,
    );
  });

  it('names the segment when its direction is out of range', () => {
    const segDir = Uint8Array.from(ACYCLIC_BOARD.segDir);
    segDir[0] = 9;
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segDir })).toThrow(/not one of 0..3/);
  });

  it('names the segment when its direction disagrees with the terminal stroke', () => {
    const segDir = Uint8Array.from(ACYCLIC_BOARD.segDir);
    segDir[0] = 1; // a's terminal stroke is genuinely south (2)
    expect(() => checkStructure({ ...ACYCLIC_BOARD, segDir })).toThrow(
      /segment 1 exits in direction 1 but its terminal stroke is 2/,
    );
  });

  it('rejects a covered-cell count that disagrees with the segment CSR', () => {
    // Drop segment b's tail (cell 9) from the flattened CSR without touching
    // occupancy: cell 9 is still occupied per occupancy, but no segment's
    // [from, to) window lists it any more, so no single-cell check catches
    // it and only the aggregate covered-vs-listed count can.
    const cells = Array.from(ACYCLIC_BOARD.segCells);
    cells.splice(5, 1);
    const segStart = Uint32Array.from(ACYCLIC_BOARD.segStart);
    for (let i = 2; i < segStart.length; i++) segStart[i] = (segStart[i] as number) - 1;
    const board: Board = { ...ACYCLIC_BOARD, segCells: Uint32Array.from(cells), segStart };

    expect(() => checkStructure(board)).toThrow(
      /16 cells are occupied but the segment CSR lists 15 cells/,
    );
  });
});
