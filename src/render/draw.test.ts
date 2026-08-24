import { describe, expect, it } from 'vitest';
import {
  ARROWHEAD_LENGTH_CELLS,
  ARROWHEAD_WIDTH_CELLS,
  LINE_WIDTH_CELLS,
  MIN_LEGIBLE_ARROWHEAD_CSS_PX,
  drawArrowhead,
  drawSegment,
  isLegibleAtScale,
  strokeSegmentPolyline,
} from './draw.js';
import { PALETTE } from './palette.js';
import { createBufferViewport, createViewport } from './viewport.js';
import { makeBoard } from '../../test/fixtures/board.js';
import type { FillContext2D, StrokeContext2D } from './draw.js';

type Call =
  | { op: 'beginPath' }
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'closePath' }
  | { op: 'stroke' }
  | { op: 'fill' };

function makeFakeCtx(): StrokeContext2D & FillContext2D & { calls: Call[] } {
  return {
    strokeStyle: '',
    fillStyle: '',
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
    closePath() {
      this.calls.push({ op: 'closePath' });
    },
    stroke() {
      this.calls.push({ op: 'stroke' });
    },
    fill() {
      this.calls.push({ op: 'fill' });
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

  it('colours the stroke from the palette by segColor and scales line width by the viewport', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.strokeStyle).toBe(PALETTE[board.segColor[0] as number]);
    expect(ctx.lineWidth).toBe(LINE_WIDTH_CELLS * 10);
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

  it('works the same over a buffer-space viewport, not just a CSS one', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createBufferViewport(10);

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 },
      { op: 'lineTo', x: 15, y: 5 },
      { op: 'lineTo', x: 15, y: 15 },
      { op: 'stroke' },
    ]);
  });
});

describe('drawArrowhead', () => {
  const scale = 10;
  // The body stroke's round cap has this radius; the arrowhead starts clear of it.
  const capRadius = (LINE_WIDTH_CELLS * scale) / 2;
  const length = ARROWHEAD_LENGTH_CELLS * scale;
  const reach = capRadius + length;
  const halfWidth = (ARROWHEAD_WIDTH_CELLS * scale) / 2;

  it('points north: tip above the head cell center, base clear of the stroke cap', () => {
    // A\na: head at (0,0), tail at (0,1) -> terminal stroke north
    const board = makeBoard(['A', 'a'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 - reach },
      { op: 'lineTo', x: 5 + halfWidth, y: 5 - capRadius },
      { op: 'lineTo', x: 5 - halfWidth, y: 5 - capRadius },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('points east: tip right of the head cell center, base clear of the stroke cap', () => {
    // aA: tail at (0,0), head at (1,0) -> terminal stroke east
    const board = makeBoard('aA');
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 15 + reach, y: 5 },
      { op: 'lineTo', x: 15 + capRadius, y: 5 + halfWidth },
      { op: 'lineTo', x: 15 + capRadius, y: 5 - halfWidth },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('points south: tip below the head cell center, base clear of the stroke cap', () => {
    // a\nA: tail at (0,0), head at (0,1) -> terminal stroke south
    const board = makeBoard(['a', 'A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 15 + reach },
      { op: 'lineTo', x: 5 - halfWidth, y: 15 + capRadius },
      { op: 'lineTo', x: 5 + halfWidth, y: 15 + capRadius },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('points west: tip left of the head cell center, base clear of the stroke cap', () => {
    // Aa: head at (0,0), tail at (1,0) -> terminal stroke west
    const board = makeBoard('Aa');
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5 - reach, y: 5 },
      { op: 'lineTo', x: 5 - capRadius, y: 5 - halfWidth },
      { op: 'lineTo', x: 5 - capRadius, y: 5 + halfWidth },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('draws a one-cell segment using its explicit segDir, not any inferred geometry', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'E' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls[1]).toEqual({ op: 'moveTo', x: 5 + reach, y: 5 });
  });

  it('sits entirely clear of the stroke cap disk, not straddling it', () => {
    const board = makeBoard(['A', 'a'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    const headCx = 5;
    const headCy = 5;
    for (const call of ctx.calls) {
      if (call.op !== 'moveTo' && call.op !== 'lineTo') continue;
      const distance = Math.hypot(call.x - headCx, call.y - headCy);
      expect(distance).toBeGreaterThanOrEqual(capRadius - 1e-9);
    }
  });

  it('fills from the palette by segColor', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.fillStyle).toBe(PALETTE[board.segColor[0] as number]);
  });

  it('throws when segDir holds a value outside 0..3', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    board.segDir[0] = 255;
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    expect(() => drawArrowhead(ctx, board, 1, viewport)).toThrow(RangeError);
  });
});

describe('drawSegment', () => {
  it('strokes the body then fills the arrowhead, both in the same palette colour', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    drawSegment(ctx, board, 1, viewport);

    expect(ctx.calls[0]).toEqual({ op: 'beginPath' });
    expect(ctx.calls.at(-1)).toEqual({ op: 'fill' });
    expect(ctx.strokeStyle).toBe(ctx.fillStyle);
  });
});

describe('isLegibleAtScale', () => {
  it('is true once the arrowhead length reaches the legibility floor', () => {
    const scaleAtFloor = MIN_LEGIBLE_ARROWHEAD_CSS_PX / ARROWHEAD_LENGTH_CELLS;
    const viewport = createViewport({ scale: scaleAtFloor });

    expect(isLegibleAtScale(viewport)).toBe(true);
  });

  it('is false just below the legibility floor', () => {
    const scaleAtFloor = MIN_LEGIBLE_ARROWHEAD_CSS_PX / ARROWHEAD_LENGTH_CELLS;
    const viewport = createViewport({ scale: scaleAtFloor - 0.01 });

    expect(isLegibleAtScale(viewport)).toBe(false);
  });

  it('is true well above the floor, false well below it', () => {
    expect(isLegibleAtScale(createViewport({ scale: 100 }))).toBe(true);
    expect(isLegibleAtScale(createViewport({ scale: 1 }))).toBe(false);
  });
});
