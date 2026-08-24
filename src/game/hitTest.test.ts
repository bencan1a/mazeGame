import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { makeBoard } from '../../test/fixtures/board.js';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';
import type { Board, SegmentId } from '../core/types.js';
import { generateBoard } from '../core/generate.js';
import { cell, cellCenterToCssPixel, createViewport, cssPixel } from '../render/viewport.js';
import { createGameState, isFree } from './state.js';
import type { GameState } from './state.js';
import { DEFAULT_TAP_RADIUS_CSS_PX, hitTest } from './hitTest.js';

/**
 * Two single-cell segments, three cells apart on row 1: `a` at (1,1) exits
 * north into open space and is always free; `b` at (4,1) exits west into
 * `a`'s cell and is blocked until `a` is removed.
 */
const TWO_SEGMENT_ART = ['......', '.A..B.', '......', '......'].join('\n');

function twoSegmentBoard(): Board {
  return makeBoard({ art: TWO_SEGMENT_ART, dirs: { a: 'N', b: 'W' } });
}

function stateWithRemoved(board: Board, removedIds: readonly number[]): GameState {
  const base = createGameState(board, DEFAULT_PLAY_PARAMS);
  const removed = new Uint8Array(board.segmentCount + 1);
  for (const id of removedIds) removed[id] = 1;
  return { ...base, removed };
}

const FREE_ID: SegmentId = 1; // 'a'
const BLOCKED_ID: SegmentId = 2; // 'b'

describe('hitTest: direct hit', () => {
  it('selects a free segment tapped directly', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const isFreePred = (id: SegmentId) => id === FREE_ID;

    const result = hitTest(board, viewport, cssPixel(15, 15), isFreePred);

    expect(result).toBe(FREE_ID);
  });
});

describe('hitTest: radius search', () => {
  it('skips a blocked segment tapped directly and snaps to a nearby free one', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred, { radiusCssPx: 40 });

    expect(result).toBe(FREE_ID);
  });

  it('never returns the blocked segment itself, however large the radius', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred, { radiusCssPx: 1000 });

    expect(result).not.toBe(BLOCKED_ID);
    expect(result).toBe(FREE_ID);
  });

  it('is a miss with no free segment in radius, not a bounce', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    // The nearest cell within 1.5 cells of `b` holding anything is `b`
    // itself, which is blocked; `a` sits 3 cells away, out of reach.
    const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred, { radiusCssPx: 15 });

    expect(result).toBeNull();
  });

  it('selects `b` directly once removing `a` makes it free', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, [FREE_ID]);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred, { radiusCssPx: 40 });

    expect(result).toBe(BLOCKED_ID);
  });
});

describe('hitTest: radius is a constant CSS-pixel size', () => {
  const B_CELL = cell(4, 1);

  it('reaches a free segment 3 cells away when zoomed out, and misses it when zoomed in', () => {
    const board = twoSegmentBoard();
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    // The default radius is 24 CSS px, so it reaches 3 cells at scale 5
    // (4.8 cells) but not at scale 10 (2.4 cells) — the same physical
    // fingertip covers fewer cells once the board is zoomed in.
    const zoomedOut = createViewport({ scale: 5 });
    const tapZoomedOut = cellCenterToCssPixel(zoomedOut, B_CELL);
    expect(hitTest(board, zoomedOut, tapZoomedOut, isFreePred)).toBe(FREE_ID);

    const zoomedIn = createViewport({ scale: 10 });
    const tapZoomedIn = cellCenterToCssPixel(zoomedIn, B_CELL);
    expect(hitTest(board, zoomedIn, tapZoomedIn, isFreePred)).toBeNull();
  });
});

describe('hitTest: malformed input', () => {
  const board = twoSegmentBoard();
  const viewport = createViewport({ scale: 10 });
  const isFreePred = (id: SegmentId) => id === FREE_ID;

  it.each([
    [NaN, 15],
    [15, NaN],
    [Infinity, 15],
    [-Infinity, 15],
    [15, Infinity],
  ])('is a miss for a non-finite tap point (%p, %p)', (x, y) => {
    expect(hitTest(board, viewport, cssPixel(x, y), isFreePred)).toBeNull();
  });

  it('is a miss for a point far outside the board', () => {
    expect(hitTest(board, viewport, cssPixel(-99999, -99999), isFreePred)).toBeNull();
    expect(hitTest(board, viewport, cssPixel(99999, 99999), isFreePred)).toBeNull();
  });

  it.each([NaN, -1, -Infinity])('rejects an invalid radiusCssPx option of %p', (bad) => {
    expect(() =>
      hitTest(board, viewport, cssPixel(15, 15), isFreePred, { radiusCssPx: bad }),
    ).toThrow(RangeError);
  });

  it('accepts a radiusCssPx of exactly 0', () => {
    expect(() =>
      hitTest(board, viewport, cssPixel(15, 15), isFreePred, { radiusCssPx: 0 }),
    ).not.toThrow();
  });
});

describe('DEFAULT_TAP_RADIUS_CSS_PX', () => {
  it('is a positive finite constant', () => {
    expect(Number.isFinite(DEFAULT_TAP_RADIUS_CSS_PX)).toBe(true);
    expect(DEFAULT_TAP_RADIUS_CSS_PX).toBeGreaterThan(0);
  });
});

describe('hitTest: never returns a blocked segment', () => {
  const boards = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
    generateBoard({ ...DEFAULT_GEN_PARAMS, gridSize: 16, seed }),
  );

  it('over arbitrary boards, tap pixels and removed-sets, a returned id is always free', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...boards),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: 4, max: 48, noNaN: true }),
        fc.array(fc.nat(500), { maxLength: 30 }),
        (board, x, y, scale, toggles) => {
          fc.pre(scale > 0);
          const state = stateWithRemoved(
            board,
            toggles.map((t) => (t % board.segmentCount) + 1),
          );
          const isFreePred = (id: SegmentId) => isFree(state, id);
          const viewport = createViewport({ scale });

          const result = hitTest(board, viewport, cssPixel(x, y), isFreePred);

          if (result !== null) {
            expect(isFreePred(result)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
