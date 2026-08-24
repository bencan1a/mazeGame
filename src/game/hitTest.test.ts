import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { makeBoard } from '../../test/fixtures/board.js';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';
import type { Board, SegmentId } from '../core/types.js';
import { generateBoard } from '../core/generate.js';
import {
  cell,
  cellCenterToCssPixel,
  createViewport,
  cssPixel,
  cssPixelToCell,
} from '../render/viewport.js';
import { animationComplete, createGameState, isFree, tap } from './state.js';
import type { GameState } from './state.js';
import { DEFAULT_TAP_RADIUS_CSS_PX, hitTest } from './hitTest.js';
import type { FreePredicate } from './hitTest.js';

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

/** Two single-cell free segments in one row, `a` at cell 2 and `b` at cell 6. */
const NEAREST_MATCH_ART = '..A...B.';

function nearestMatchBoard(): Board {
  return makeBoard({ art: NEAREST_MATCH_ART, dirs: { a: 'E', b: 'E' } });
}

const ALWAYS_FREE: FreePredicate = () => true;

describe('hitTest: direct hit', () => {
  it('selects a free segment tapped directly', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const isFreePred = (id: SegmentId) => id === FREE_ID;

    const result = hitTest(board, viewport, cssPixel(15, 15), isFreePred);

    expect(result).toBe(FREE_ID);
  });

  it("returns a blocked segment tapped directly, not the radius search's free alternative", () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    // `b` (blocked) is tapped directly; `a` (free) sits 3 cells away and
    // would otherwise be the radius search's answer at this radius.
    const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred, { radiusCssPx: 1000 });

    expect(result).toBe(BLOCKED_ID);
  });

  it('returns the same occupant regardless of free/blocked status, since a direct hit never consults isFree', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const point = cssPixel(45, 15);

    const whileBlocked = stateWithRemoved(board, []);
    expect(hitTest(board, viewport, point, (id: SegmentId) => isFree(whileBlocked, id))).toBe(
      BLOCKED_ID,
    );

    const onceFree = stateWithRemoved(board, [FREE_ID]);
    expect(hitTest(board, viewport, point, (id: SegmentId) => isFree(onceFree, id))).toBe(
      BLOCKED_ID,
    );
  });
});

describe('hitTest: a direct hit on a blocked segment is a bounce', () => {
  it('drives tap() to a bounced outcome that costs exactly one life', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred);
    expect(result).toBe(BLOCKED_ID);

    const after = tap(state, result);

    expect(after.lastOutcome).toEqual({
      kind: 'bounced',
      id: BLOCKED_ID,
      livesRemaining: state.lives - 1,
    });
    expect(after.lives).toBe(state.lives - 1);
  });

  it('reaches lost status once enough direct-hit bounces exhaust every life', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    let state = stateWithRemoved(board, []);
    const startingLives = state.lives;

    for (let i = 0; i < startingLives; i++) {
      const isFreePred = (id: SegmentId) => isFree(state, id);
      const result = hitTest(board, viewport, cssPixel(45, 15), isFreePred);
      state = animationComplete(tap(state, result));
    }

    expect(state.status).toBe('lost');
    expect(state.lives).toBe(0);
  });
});

describe('hitTest: radius search (empty direct hit)', () => {
  it('skips a blocked segment and snaps to a nearby free one', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    // Tap lands on the empty cell between `a` and `b`. `b`'s box is only
    // 5px away but blocked; `a`'s box, 15px away, is the only free option.
    const result = hitTest(board, viewport, cssPixel(35, 15), isFreePred, { radiusCssPx: 40 });

    expect(result).toBe(FREE_ID);
  });

  it('never returns the blocked segment itself, however large the radius', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    const result = hitTest(board, viewport, cssPixel(35, 15), isFreePred, { radiusCssPx: 1000 });

    expect(result).not.toBe(BLOCKED_ID);
    expect(result).toBe(FREE_ID);
  });

  it('is a miss with no free segment in radius, not a bounce', () => {
    const board = twoSegmentBoard();
    const viewport = createViewport({ scale: 10 });
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    // `a`'s box is 15px from the tap; `b`'s box is 5px away but blocked, so
    // a 10px radius reaches neither a free segment nor a bounceable one.
    const result = hitTest(board, viewport, cssPixel(35, 15), isFreePred, { radiusCssPx: 10 });

    expect(result).toBeNull();
  });
});

describe('hitTest: radius is a constant CSS-pixel size', () => {
  const EMPTY_CELL = cell(3, 1);

  it('reaches a free segment when zoomed out, and misses it when zoomed in', () => {
    const board = twoSegmentBoard();
    const state = stateWithRemoved(board, []);
    const isFreePred = (id: SegmentId) => isFree(state, id);

    // `a`'s box is 1.5 cells from this empty tapped cell, so its pixel
    // distance is 1.5x the scale: 15px at scale 10, 30px at scale 20 — on
    // either side of the default 24px radius.
    const zoomedOut = createViewport({ scale: 10 });
    const tapZoomedOut = cellCenterToCssPixel(zoomedOut, EMPTY_CELL);
    expect(hitTest(board, zoomedOut, tapZoomedOut, isFreePred)).toBe(FREE_ID);

    const zoomedIn = createViewport({ scale: 20 });
    const tapZoomedIn = cellCenterToCssPixel(zoomedIn, EMPTY_CELL);
    expect(hitTest(board, zoomedIn, tapZoomedIn, isFreePred)).toBeNull();
  });
});

describe('hitTest: nearest match is pixel distance, not cell-index count', () => {
  it('picks the pixel-nearer of two free segments the same number of cells away', () => {
    const board = nearestMatchBoard();
    const viewport = createViewport({ scale: 10 });

    // Tap lands in the empty cell 4, two cell-indices from both `a` (cell 2)
    // and `b` (cell 6) — a row-major or leftmost tie-break would pick `a`.
    // `a`'s box is 19.9px away, `b`'s is 10.1px: `b` is the real answer.
    const result = hitTest(board, viewport, cssPixel(49.9, 5), ALWAYS_FREE, {
      radiusCssPx: 40,
    });

    expect(result).toBe(2); // 'b'
  });

  it('reaches a cell across a shared boundary even when the board is zoomed in past the radius', () => {
    const board = nearestMatchBoard();
    const viewport = createViewport({ scale: 100 });

    // `a` occupies cell 2, spanning [200, 300) at this scale — far wider
    // than the default 24px radius — but a tap 1px into its neighbour is
    // still within 24px of `a`'s own edge.
    const tapNearBoundary = cssPixel(301, 50);
    expect(hitTest(board, viewport, tapNearBoundary, ALWAYS_FREE)).toBe(1);

    const tapFarFromBoundary = cssPixel(350, 50);
    expect(hitTest(board, viewport, tapFarFromBoundary, ALWAYS_FREE)).toBeNull();
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

describe('hitTest: property tests over generated boards', () => {
  const boards = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
    generateBoard({ ...DEFAULT_GEN_PARAMS, gridSize: 16, seed }),
  );

  function inBounds(board: Board, x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < board.width && y < board.height;
  }

  it('a result from an empty or out-of-bounds direct hit is always free; an occupied direct hit always returns its occupant', () => {
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
          const point = cssPixel(x, y);

          const directCell = cssPixelToCell(viewport, point);
          const directOccupant = inBounds(board, directCell.x, directCell.y)
            ? (board.occupancy[directCell.y * board.width + directCell.x] as SegmentId)
            : 0;

          const result = hitTest(board, viewport, point, isFreePred);

          if (directOccupant !== 0) {
            // The radius search never runs: the direct hit owns the answer,
            // free or blocked.
            expect(result).toBe(directOccupant);
          } else if (result !== null) {
            // The radius search ran and must never hand back a blocked id.
            expect(isFreePred(result)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
