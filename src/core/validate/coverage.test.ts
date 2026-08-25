import { describe, expect, it } from 'vitest';
import type { Mask } from '../types.js';
import { maskFrom } from '../mask/index.js';
import {
  ACYCLIC_BOARD_ART,
  ACYCLIC_BOARD_WALKS,
  makeBoardAndMask,
  makeMask,
} from '../../../test/fixtures/index.js';
import { checkCoverage } from './coverage.js';

const { board, mask } = makeBoardAndMask({ art: ACYCLIC_BOARD_ART, walks: ACYCLIC_BOARD_WALKS });

describe('checkCoverage', () => {
  it('accepts a board that covers every inside cell', () => {
    expect(() => checkCoverage(board, mask)).not.toThrow();
  });

  it('rejects a board and mask of different sizes', () => {
    const bigger = makeMask({ width: 6, height: 6 });
    expect(() => checkCoverage(board, bigger)).toThrow(/board is 4x4, mask is 6x6/);
  });

  it('names the cell when it is occupied but the mask marks it outside', () => {
    const inside = Uint8Array.from(mask.inside);
    inside[0] = 0;
    const shrunk: Mask = { ...mask, inside };
    expect(() => checkCoverage(board, shrunk)).toThrow(
      /cell 0 is occupied but the mask marks it outside/,
    );
  });

  it('names the cell when it is occupied but the mask marks it unvisited', () => {
    const unvisited = Uint8Array.from(mask.unvisited);
    unvisited[0] = 1;
    const marked: Mask = { ...mask, unvisited };
    expect(() => checkCoverage(board, marked)).toThrow(
      /cell 0 is occupied but the mask marks it unvisited/,
    );
  });

  it('names the cell when an inside cell is neither covered nor explained by unvisited', () => {
    // Zeroing occupancy alone leaves the segment CSR inconsistent, which is
    // fine here: only occupancy and the mask are read.
    const occupancy = Uint16Array.from(board.occupancy);
    occupancy[0] = 0;
    const gappyBoard = { ...board, occupancy };
    expect(() => checkCoverage(gappyBoard, mask)).toThrow(
      /cell 0 of mask region 1 is inside the mask, not covered by any segment/,
    );
  });

  it('rejects a mask with no inside cells', () => {
    const empty: Mask = maskFrom({
      width: 1,
      height: 1,
      inside: new Uint8Array(1),
      unvisited: new Uint8Array(1),
    });
    const emptyBoardShape = { ...board, width: 1, height: 1, occupancy: new Uint16Array(1) };
    expect(() => checkCoverage(emptyBoardShape, empty)).toThrow(/no inside cells/);
  });

  it('names the region when one lobe of a multi-lobe silhouette is left uncovered', () => {
    // Two 2x2 lobes side by side; only the first is covered. Board-wide that
    // is 50%, but what the message has to say is which lobe went missing.
    const twoLobes = makeMask(['##.##', '##.##'].join('\n'));
    expect(twoLobes.regionCount).toBe(2);
    const lobeBoard = {
      ...board,
      width: 5,
      height: 2,
      occupancy: Uint16Array.from([1, 1, 0, 0, 0, 1, 1, 0, 0, 0]),
    };
    expect(() => checkCoverage(lobeBoard, twoLobes)).toThrow(
      /cell 3 of mask region 2 is inside the mask, not covered by any segment/,
    );
  });

  it('rejects a region label that does not match the path cells it should mark', () => {
    const regionOf = Uint16Array.from(mask.regionOf);
    regionOf[0] = 0;
    expect(() => checkCoverage(board, { ...mask, regionOf })).toThrow(
      /cell 0 is labelled region 0 but inside=1 unvisited=0/,
    );
  });

  it('rejects a region id outside 1..regionCount', () => {
    const regionOf = Uint16Array.from(mask.regionOf);
    regionOf[0] = 7;
    expect(() => checkCoverage(board, { ...mask, regionOf })).toThrow(
      /cell 0 is labelled region 7, outside 1\.\.1/,
    );
  });

  it('rejects a regionCount that claims a region with no cells', () => {
    expect(() => checkCoverage(board, { ...mask, regionCount: 2 })).toThrow(
      /mask region 2 has no path cells/,
    );
  });

  it('fails the coverage floor when too much of the mask is left uncovered by unvisited cells', () => {
    // 9-cell mask with one cell unvisited: coverage 8/9 ~= 88.9%, under the
    // floor, even though the uncovered cell is legitimately unvisited.
    const small = makeMask(['###', '#o#', '###'].join('\n'));
    const smallBoard = {
      ...board,
      width: 3,
      height: 3,
      occupancy: Uint16Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]),
    };
    expect(() => checkCoverage(smallBoard, small)).toThrow(/below the 99% floor/);
  });
});
