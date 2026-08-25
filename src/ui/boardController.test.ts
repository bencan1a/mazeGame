import { describe, expect, it } from 'vitest';
import { boardPanBounds, removedSetChanged } from './boardController.js';
import { clampPan, createViewport } from '../render/index.js';
import { makeBoard } from '../../test/fixtures/board.js';

describe('removedSetChanged', () => {
  it('reports a change before anything has been painted, even for an empty set', () => {
    expect(removedSetChanged(null, new Set())).toBe(true);
  });

  it('reports no change when the same set is painted again', () => {
    expect(removedSetChanged(new Set([1, 2]), new Set([2, 1]))).toBe(false);
    expect(removedSetChanged(new Set(), new Set())).toBe(false);
  });

  it('reports a change when a segment is added or swapped', () => {
    expect(removedSetChanged(new Set([1]), new Set([1, 2]))).toBe(true);
    expect(removedSetChanged(new Set([1, 2]), new Set([1, 3]))).toBe(true);
  });
});

describe('boardPanBounds', () => {
  const board = makeBoard(['aA.', '...', '...'].join('\n'));

  it('gives the board size in cells, since clampPan applies the scale itself', () => {
    const bounds = boardPanBounds(board, 300, 600);
    expect(bounds.boardWidth).toBe(board.width);
    expect(bounds.boardHeight).toBe(board.height);
  });

  it('centres a board that fits the canvas', () => {
    // 3 cells at scale 10 is 30 CSS px against a 300x600 canvas, so the
    // origin lands at (300 - 30) / 2 and (600 - 30) / 2.
    const clamped = clampPan(createViewport({ scale: 10 }), boardPanBounds(board, 300, 600));
    expect(clamped.originX).toBe(135);
    expect(clamped.originY).toBe(285);
  });

  it('does not centre once the board is larger than the canvas', () => {
    // Passing CSS pixels instead of cells scaled the board twice and left it
    // pinned at the origin rather than centred.
    const clamped = clampPan(createViewport({ scale: 200 }), boardPanBounds(board, 300, 600));
    expect(clamped.originX).toBeLessThanOrEqual(0);
    expect(clamped.originY).toBeLessThanOrEqual(0);
  });
});
