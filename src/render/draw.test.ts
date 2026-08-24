import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_LINE_WIDTH_CELLS,
  PLACEHOLDER_STROKE_STYLE,
  strokeSegmentPolyline,
} from './draw.js';
import { createViewport } from './viewport.js';
import { makeBoard } from '../../test/fixtures/board.js';
import type { StrokeContext2D } from './draw.js';

type Call =
  | { op: 'beginPath' }
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'stroke' };

function makeFakeCtx(): StrokeContext2D & { calls: Call[] } {
  return {
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: 'miter',
    lineCap: 'butt',
    calls: [],
    beginPath() {
      this.calls.push({ op: 'beginPath' });
    },
    moveTo(x, y) {
      this.calls.push({ op: 'moveTo', x, y });
    },
    lineTo(x, y) {
      this.calls.push({ op: 'lineTo', x, y });
    },
    stroke() {
      this.calls.push({ op: 'stroke' });
    },
  };
}

describe('strokeSegmentPolyline', () => {
  it('strokes cell-center to cell-center in segment (tail to head) order', () => {
    // a: (0,0)->(1,0)->(1,1), head at (1,1)
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 },
      { op: 'lineTo', x: 15, y: 5 },
      { op: 'lineTo', x: 15, y: 15 },
      { op: 'stroke' },
    ]);
  });

  it('sets a placeholder style and scales line width by the viewport', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.strokeStyle).toBe(PLACEHOLDER_STROKE_STYLE);
    expect(ctx.lineWidth).toBe(PLACEHOLDER_LINE_WIDTH_CELLS * 10);
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineCap).toBe('round');
  });

  it('draws a visible dot for a one-cell segment', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 },
      { op: 'lineTo', x: 5, y: 5 },
      { op: 'stroke' },
    ]);
  });

  it('honours the viewport origin and scale together', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.calls[1]).toEqual({ op: 'moveTo', x: 110, y: 60 });
  });
});
