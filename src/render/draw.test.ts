import { describe, expect, it } from 'vitest';
import {
  ARROWHEAD_LENGTH_CELLS,
  ARROWHEAD_WIDTH_CELLS,
  LINE_WIDTH_CELLS,
  MIN_LEGIBLE_ARROWHEAD_CSS_PX,
  REFERENCE_CSS_VIEWPORT_WIDTH,
  drawArrowhead,
  drawSegment,
  drawSegmentGuarded,
  isBoardLegibleUnzoomed,
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

describe('arrowhead sizing stays within one cell', () => {
  it('never lets ARROWHEAD_LENGTH_CELLS or ARROWHEAD_WIDTH_CELLS exceed 1, which is what keeps the triangle out of a neighbouring cell', () => {
    expect(ARROWHEAD_LENGTH_CELLS).toBeLessThanOrEqual(1);
    expect(ARROWHEAD_WIDTH_CELLS).toBeLessThanOrEqual(1);
  });
});

describe('strokeSegmentPolyline', () => {
  const scale = 10;
  const capRadius = (LINE_WIDTH_CELLS * scale) / 2;
  const setback = 0.5 * scale - capRadius;

  it('strokes cell-center to cell-center, except the last vertex which stops short of the head cell center', () => {
    // a: (0,0)->(1,0)->(1,1), head at (1,1), terminal stroke south
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 },
      { op: 'lineTo', x: 15, y: 5 },
      { op: 'lineTo', x: 15, y: 15 - setback },
      { op: 'stroke' },
    ]);
  });

  it('colours the stroke from the palette by segColor and scales line width by the viewport', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.strokeStyle).toBe(PALETTE[board.segColor[0] as number]);
    expect(ctx.lineWidth).toBe(LINE_WIDTH_CELLS * scale);
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineCap).toBe('round');
  });

  it('draws a visible dot for a one-cell segment, at its exact center', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

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
    const viewport = createBufferViewport(scale);

    strokeSegmentPolyline(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 },
      { op: 'lineTo', x: 15, y: 5 },
      { op: 'lineTo', x: 15, y: 15 - setback },
      { op: 'stroke' },
    ]);
  });

  it('throws when a multi-cell segment has a segDir outside 0..3', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    board.segDir[0] = 255;
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    expect(() => strokeSegmentPolyline(ctx, board, 1, viewport)).toThrow(RangeError);
  });
});

describe('drawArrowhead', () => {
  const scale = 10;
  const half = (ARROWHEAD_LENGTH_CELLS * scale) / 2;
  const halfWidth = (ARROWHEAD_WIDTH_CELLS * scale) / 2;

  it('points north: tip above the head cell center, base at its near edge', () => {
    // A\na: head at (0,0), tail at (0,1) -> terminal stroke north
    const board = makeBoard(['A', 'a'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 5 - half },
      { op: 'lineTo', x: 5 + halfWidth, y: 5 + half },
      { op: 'lineTo', x: 5 - halfWidth, y: 5 + half },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('points east: tip right of the head cell center, base at its near edge', () => {
    // aA: tail at (0,0), head at (1,0) -> terminal stroke east
    const board = makeBoard('aA');
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 15 + half, y: 5 },
      { op: 'lineTo', x: 15 - half, y: 5 + halfWidth },
      { op: 'lineTo', x: 15 - half, y: 5 - halfWidth },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('points south: tip below the head cell center, base at its near edge', () => {
    // a\nA: tail at (0,0), head at (0,1) -> terminal stroke south
    const board = makeBoard(['a', 'A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5, y: 15 + half },
      { op: 'lineTo', x: 5 - halfWidth, y: 15 - half },
      { op: 'lineTo', x: 5 + halfWidth, y: 15 - half },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('points west: tip left of the head cell center, base at its near edge', () => {
    // Aa: head at (0,0), tail at (1,0) -> terminal stroke west
    const board = makeBoard('Aa');
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls).toEqual([
      { op: 'beginPath' },
      { op: 'moveTo', x: 5 - half, y: 5 },
      { op: 'lineTo', x: 5 + half, y: 5 - halfWidth },
      { op: 'lineTo', x: 5 + half, y: 5 + halfWidth },
      { op: 'closePath' },
      { op: 'fill' },
    ]);
  });

  it('draws a one-cell segment using its explicit segDir, not any inferred geometry', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'E' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.calls[1]).toEqual({ op: 'moveTo', x: 5 + half, y: 5 });
  });

  it('never reaches past half a cell from the head center, on-axis or across, so it cannot read as a neighbouring cell', () => {
    const cases: Array<[ReturnType<typeof makeBoard>, number, number]> = [
      [makeBoard(['A', 'a'].join('\n')), 5, 5], // north, head at (0,0)
      [makeBoard('aA'), 15, 5], // east, head at (1,0)
      [makeBoard(['a', 'A'].join('\n')), 5, 15], // south, head at (0,1)
      [makeBoard('Aa'), 5, 5], // west, head at (0,0)
    ];
    for (const [board, cx, cy] of cases) {
      const ctx = makeFakeCtx();
      const viewport = createViewport({ scale });
      drawArrowhead(ctx, board, 1, viewport);
      for (const call of ctx.calls) {
        if (call.op !== 'moveTo' && call.op !== 'lineTo') continue;
        expect(Math.abs(call.x - cx)).toBeLessThanOrEqual(half + 1e-9);
        expect(Math.abs(call.y - cy)).toBeLessThanOrEqual(half + 1e-9);
      }
    }
  });

  it("overlaps the stroke's endpoint into the base instead of only touching it", () => {
    // A\na: north-pointing, 2 cells, so strokeSegmentPolyline's shortened
    // last vertex and drawArrowhead's base line both exist to compare.
    const board = makeBoard(['A', 'a'].join('\n'));
    const viewport = createViewport({ scale });

    const strokeCtx = makeFakeCtx();
    strokeSegmentPolyline(strokeCtx, board, 1, viewport);
    const strokeEnd = strokeCtx.calls.find((call) => call.op === 'lineTo');

    const arrowCtx = makeFakeCtx();
    drawArrowhead(arrowCtx, board, 1, viewport);
    const base = arrowCtx.calls.find((call) => call.op === 'lineTo');

    if (strokeEnd?.op !== 'lineTo' || base?.op !== 'lineTo') {
      throw new Error('expected both a stroke and a base lineTo call');
    }
    // North points toward smaller y; the stroke's endpoint sits closer to
    // the tip (smaller y) than the base line, i.e. inside the triangle.
    expect(strokeEnd.y).toBeLessThan(base.y);
  });

  it('fills from the palette by segColor', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

    drawArrowhead(ctx, board, 1, viewport);

    expect(ctx.fillStyle).toBe(PALETTE[board.segColor[0] as number]);
  });

  it('throws when segDir holds a value outside 0..3', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    board.segDir[0] = 255;
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale });

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

describe('drawSegmentGuarded', () => {
  it('draws normally and returns true for a healthy segment', () => {
    const board = makeBoard(['aa', '.A'].join('\n'));
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    expect(drawSegmentGuarded(ctx, board, 1, viewport)).toBe(true);
    expect(ctx.calls.at(-1)).toEqual({ op: 'fill' });
  });

  it('returns false instead of throwing for a malformed segDir', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    board.segDir[0] = 255;
    const ctx = makeFakeCtx();
    const viewport = createViewport({ scale: 10 });

    expect(() => drawSegmentGuarded(ctx, board, 1, viewport)).not.toThrow();
    expect(drawSegmentGuarded(ctx, board, 1, viewport)).toBe(false);
  });

  it('still propagates a failure that is not malformed segment data', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const ctx: FillContext2D & StrokeContext2D = {
      ...makeFakeCtx(),
      stroke(): void {
        throw new Error('context is lost');
      },
    };
    const viewport = createViewport({ scale: 10 });

    expect(() => drawSegmentGuarded(ctx, board, 1, viewport)).toThrow('context is lost');
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

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a viewport scale of %p', (bad) => {
    const viewport = { space: 'css' as const, scale: bad, dpr: 1, originX: 0, originY: 0 };
    expect(() => isLegibleAtScale(viewport)).toThrow(RangeError);
  });
});

describe('isBoardLegibleUnzoomed', () => {
  it('reports a ~40-cell square board legible in the reference viewport (R4)', () => {
    expect(isBoardLegibleUnzoomed(40, 40)).toBe(true);
  });

  it('reports a 100-cell square board illegible in the reference viewport', () => {
    expect(isBoardLegibleUnzoomed(100, 100)).toBe(false);
  });

  it('uses the smaller of width/boardWidth and height/boardHeight, so a non-square board is not judged by its longer axis alone', () => {
    // 10 wide, 80 tall: width alone gives 39 px/cell (legible), but the
    // constraining height ratio is 390/80 = 4.875 px/cell (not) — this is
    // the case a width-only check gets wrong.
    expect(isBoardLegibleUnzoomed(10, 80)).toBe(false);
    // A square board of the same width is legible at the same viewport.
    expect(isBoardLegibleUnzoomed(10, 10)).toBe(true);
  });

  it('uses the actual available CSS size when given one, not just the default', () => {
    // A 100-cell square board is legible if the viewport is wide and tall enough.
    const roomy = 100 * (MIN_LEGIBLE_ARROWHEAD_CSS_PX + 1);
    expect(isBoardLegibleUnzoomed(100, 100, roomy, roomy)).toBe(true);
    // A 20-cell square board is illegible in a viewport too small in both axes.
    const cramped = 20 * (MIN_LEGIBLE_ARROWHEAD_CSS_PX - 1);
    expect(isBoardLegibleUnzoomed(20, 20, cramped, cramped)).toBe(false);
  });

  it('uses the smaller of the viewport width and height, so a wide-but-short landscape viewport is not legible by width alone', () => {
    // 60 cells across a landscape phone: width 844 alone gives ~14 px/cell
    // (legible), but the constraining height of 390 gives ~6.5 (not).
    expect(isBoardLegibleUnzoomed(60, 60, 844, 390)).toBe(false);
    // With a tall-enough height too, the same width does report legible —
    // confirming it was the height, not the board, that flipped the answer.
    expect(isBoardLegibleUnzoomed(60, 60, 844, 844)).toBe(true);
  });

  it('defaults both width and height to REFERENCE_CSS_VIEWPORT_WIDTH', () => {
    expect(isBoardLegibleUnzoomed(40, 40)).toBe(
      isBoardLegibleUnzoomed(40, 40, REFERENCE_CSS_VIEWPORT_WIDTH, REFERENCE_CSS_VIEWPORT_WIDTH),
    );
  });

  it.each([NaN, Infinity, 0, -1])('rejects a boardWidthCells of %p', (bad) => {
    expect(() => isBoardLegibleUnzoomed(bad, 40)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, 0, -1])('rejects a boardHeightCells of %p', (bad) => {
    expect(() => isBoardLegibleUnzoomed(40, bad)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, 0, -1])('rejects an availableCssWidth of %p', (bad) => {
    expect(() => isBoardLegibleUnzoomed(40, 40, bad)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, 0, -1])('rejects an availableCssHeight of %p', (bad) => {
    expect(() => isBoardLegibleUnzoomed(40, 40, REFERENCE_CSS_VIEWPORT_WIDTH, bad)).toThrow(
      RangeError,
    );
  });
});
