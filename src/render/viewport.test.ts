import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type BlitContext2D,
  blitStaticLayer,
  cell,
  cellCenterToCssPixel,
  cellCenterX,
  cellCenterY,
  cellSizeInDevicePixels,
  cellToCssPixel,
  cellToDevicePixel,
  clampPan,
  clampZoomScale,
  computeBlitRects,
  createBufferViewport,
  createViewport,
  cssPixel,
  cssPixelToCell,
  cssPixelToDevicePixel,
  devicePixel,
  devicePixelToCell,
  devicePixelToCssPixel,
  maxZoomScale,
  panViewport,
  zoomViewportAt,
} from './viewport.js';
import type { Viewport } from './viewport.js';

describe('createViewport', () => {
  it('defaults dpr to 1 and origin to (0, 0), tagged as a css-space viewport', () => {
    const viewport = createViewport({ scale: 20 });
    expect(viewport).toEqual({ space: 'css', scale: 20, dpr: 1, originX: 0, originY: 0 });
  });

  it('keeps every explicit field', () => {
    const viewport = createViewport({ scale: 20, dpr: 3, originX: 5, originY: -8 });
    expect(viewport).toEqual({ space: 'css', scale: 20, dpr: 3, originX: 5, originY: -8 });
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a scale of %p', (bad) => {
    expect(() => createViewport({ scale: bad })).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a dpr of %p', (bad) => {
    expect(() => createViewport({ scale: 20, dpr: bad })).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite originX', (bad) => {
    expect(() => createViewport({ scale: 20, originX: bad })).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite originY', (bad) => {
    expect(() => createViewport({ scale: 20, originY: bad })).toThrow(RangeError);
  });

  it('allows a negative finite origin, a pan offset', () => {
    expect(() => createViewport({ scale: 20, originX: -500, originY: -20 })).not.toThrow();
  });
});

describe('createBufferViewport', () => {
  it('tags the result as buffer-space, with dpr fixed at 1', () => {
    const viewport = createBufferViewport(90);
    expect(viewport).toEqual({ space: 'buffer', scale: 90, dpr: 1, originX: 0, originY: 0 });
  });

  it('accepts an explicit origin', () => {
    const viewport = createBufferViewport(90, 5, -3);
    expect(viewport).toEqual({ space: 'buffer', scale: 90, dpr: 1, originX: 5, originY: -3 });
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a scale of %p', (bad) => {
    expect(() => createBufferViewport(bad)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite origin', (bad) => {
    expect(() => createBufferViewport(90, bad, 0)).toThrow(RangeError);
    expect(() => createBufferViewport(90, 0, bad)).toThrow(RangeError);
  });
});

describe('cellToCssPixel', () => {
  it('places cell (0, 0) at the origin', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    expect(cellToCssPixel(viewport, cell(0, 0))).toEqual({ x: 100, y: 50 });
  });

  it('scales by cell distance from the origin', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    expect(cellToCssPixel(viewport, cell(3, 2))).toEqual({ x: 160, y: 90 });
  });
});

describe('cssPixelToCell', () => {
  it('inverts cellToCssPixel at a cell corner', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    const corner = cellToCssPixel(viewport, cell(3, 2));
    expect(cssPixelToCell(viewport, corner)).toEqual({ x: 3, y: 2 });
  });

  it('floors toward the containing cell, not the nearest one', () => {
    const viewport = createViewport({ scale: 20 });
    expect(cssPixelToCell(viewport, cssPixel(39, 0))).toEqual({ x: 1, y: 0 });
    expect(cssPixelToCell(viewport, cssPixel(40, 0))).toEqual({ x: 2, y: 0 });
  });
});

describe('cell <-> CSS pixel round trip', () => {
  it('is the identity for every in-bounds cell across a range of scales', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (width, height, cellX, cellY, scale, originX, originY) => {
          fc.pre(cellX < width && cellY < height);
          const viewport = createViewport({ scale, originX, originY });
          const c = cell(cellX, cellY);
          const center = cellCenterToCssPixel(viewport, c);
          expect(cssPixelToCell(viewport, center)).toEqual(c);
        },
      ),
    );
  });
});

describe('cell <-> device pixel round trip', () => {
  it('is the identity for every in-bounds cell across a range of scales and dprs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        (cellX, cellY, scale, dpr, originX, originY) => {
          const viewport = createViewport({ scale, dpr, originX, originY });
          const c = cell(cellX, cellY);
          const halfCellDevice = cellSizeInDevicePixels(viewport) / 2;
          const topLeftDevice = cellToDevicePixel(viewport, c);
          const centerDevice = devicePixel(
            topLeftDevice.x + halfCellDevice,
            topLeftDevice.y + halfCellDevice,
          );
          expect(devicePixelToCell(viewport, centerDevice)).toEqual(c);
        },
      ),
    );
  });
});

describe('cssPixelToDevicePixel / devicePixelToCssPixel', () => {
  it('are inverses at a given dpr', () => {
    const viewport = createViewport({ scale: 20, dpr: 3 });
    const point = cssPixel(12.5, -4);
    expect(devicePixelToCssPixel(viewport, cssPixelToDevicePixel(viewport, point))).toEqual(point);
  });
});

describe('cellSizeInDevicePixels', () => {
  it('multiplies scale by dpr', () => {
    expect(cellSizeInDevicePixels(createViewport({ scale: 27, dpr: 3 }))).toBe(81);
  });
});

describe('cellCenterX / cellCenterY', () => {
  it('matches cellCenterToCssPixel component-wise, without allocating a Cell or a pixel object', () => {
    const viewport = createViewport({ scale: 20, originX: 5, originY: -3 });
    const point = cellCenterToCssPixel(viewport, cell(4, 7));
    expect(cellCenterX(viewport, 4)).toBe(point.x);
    expect(cellCenterY(viewport, 7)).toBe(point.y);
  });

  it('works the same over a buffer-space viewport', () => {
    const viewport = createBufferViewport(90, 10, -10);
    expect(cellCenterX(viewport, 2)).toBe(10 + 2 * 90 + 45);
    expect(cellCenterY(viewport, 2)).toBe(-10 + 2 * 90 + 45);
  });
});

describe('panViewport', () => {
  it('translates the origin by a CSS-pixel delta', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    expect(panViewport(viewport, 15, -30)).toEqual({
      space: 'css',
      scale: 20,
      dpr: 1,
      originX: 115,
      originY: 20,
    });
  });

  it('leaves scale and dpr untouched', () => {
    const viewport = createViewport({ scale: 20, dpr: 3 });
    const panned = panViewport(viewport, 5, 5);
    expect(panned.scale).toBe(20);
    expect(panned.dpr).toBe(3);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite dx', (bad) => {
    expect(() => panViewport(createViewport({ scale: 20 }), bad, 0)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite dy', (bad) => {
    expect(() => panViewport(createViewport({ scale: 20 }), 0, bad)).toThrow(RangeError);
  });
});

describe('zoomViewportAt', () => {
  it('rescales and repositions the origin', () => {
    const viewport = createViewport({ scale: 10, originX: 0, originY: 0 });
    // Focal point (50, 50) sits over board cell (5, 5) at scale 10; doubling
    // the scale must keep that same board point under the same CSS pixel.
    const zoomed = zoomViewportAt(viewport, 20, 50, 50);
    expect(zoomed.scale).toBe(20);
    expect(zoomed.originX).toBe(-50);
    expect(zoomed.originY).toBe(-50);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a nextScale of %p', (bad) => {
    expect(() => zoomViewportAt(createViewport({ scale: 10 }), bad, 0, 0)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite focalX', (bad) => {
    expect(() => zoomViewportAt(createViewport({ scale: 10 }), 20, bad, 0)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite focalY', (bad) => {
    expect(() => zoomViewportAt(createViewport({ scale: 10 }), 20, 0, bad)).toThrow(RangeError);
  });

  it('keeps the board point under the focal point fixed, across scales', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        (scale, nextScale, originX, originY, focalX, focalY) => {
          const viewport = createViewport({ scale, originX, originY });
          const boardXBefore = (focalX - viewport.originX) / viewport.scale;
          const boardYBefore = (focalY - viewport.originY) / viewport.scale;

          const zoomed = zoomViewportAt(viewport, nextScale, focalX, focalY);
          const boardXAfter = (focalX - zoomed.originX) / zoomed.scale;
          const boardYAfter = (focalY - zoomed.originY) / zoomed.scale;

          expect(boardXAfter).toBeCloseTo(boardXBefore, 6);
          expect(boardYAfter).toBeCloseTo(boardYBefore, 6);
        },
      ),
    );
  });

  it('zoom then unzoom about the same focal point returns the original viewport', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        fc.double({ min: 0, max: 800, noNaN: true }),
        (scale, nextScale, originX, originY, focalX, focalY) => {
          const viewport = createViewport({ scale, originX, originY });
          const zoomed = zoomViewportAt(viewport, nextScale, focalX, focalY);
          const back = zoomViewportAt(zoomed, viewport.scale, focalX, focalY);

          expect(back.originX).toBeCloseTo(viewport.originX, 6);
          expect(back.originY).toBeCloseTo(viewport.originY, 6);
          expect(back.scale).toBe(viewport.scale);
        },
      ),
    );
  });
});

describe('maxZoomScale', () => {
  it('is buffer pixels per cell divided by dpr', () => {
    expect(maxZoomScale(90, 3)).toBe(30);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a bufferPixelsPerCell of %p', (bad) => {
    expect(() => maxZoomScale(bad, 1)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a dpr of %p', (bad) => {
    expect(() => maxZoomScale(90, bad)).toThrow(RangeError);
  });
});

describe('clampZoomScale', () => {
  it('passes a scale already within bounds through unchanged', () => {
    expect(clampZoomScale(20, 5, 40)).toBe(20);
  });

  it('clamps to the max when the request exceeds it', () => {
    expect(clampZoomScale(100, 5, 40)).toBe(40);
  });

  it('clamps to the min when the request falls short', () => {
    expect(clampZoomScale(1, 5, 40)).toBe(5);
  });

  it('rejects a minScale above maxScale', () => {
    expect(() => clampZoomScale(20, 40, 5)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a scale of %p', (bad) => {
    expect(() => clampZoomScale(bad, 5, 40)).toThrow(RangeError);
  });

  it('never lets a requested scale exceed the buffer-derived cap, however extreme the request', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1e6, noNaN: true }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        (requested, bufferPixelsPerCell, dpr) => {
          const cap = maxZoomScale(bufferPixelsPerCell, dpr);
          const min = Math.min(1, cap);
          const clamped = clampZoomScale(requested, min, cap);
          expect(clamped).toBeLessThanOrEqual(cap);
          expect(clamped * dpr).toBeLessThanOrEqual(bufferPixelsPerCell + 1e-9);
        },
      ),
    );
  });
});

describe('clampPan', () => {
  it('centers a board smaller than the canvas rather than letting it drift', () => {
    // 10 cells * scale 10 = 100px board, inside an 800px canvas.
    const viewport = createViewport({ scale: 10, originX: 500, originY: -500 });
    const clamped = clampPan(viewport, {
      boardWidth: 10,
      boardHeight: 10,
      canvasCssWidth: 800,
      canvasCssHeight: 800,
    });
    expect(clamped.originX).toBe(350);
    expect(clamped.originY).toBe(350);
  });

  it('keeps a board larger than the canvas from being panned entirely away', () => {
    // 100 cells * scale 10 = 1000px board, inside an 800px canvas.
    const viewport = createViewport({ scale: 10, originX: 5000, originY: -5000 });
    const clamped = clampPan(viewport, {
      boardWidth: 100,
      boardHeight: 100,
      canvasCssWidth: 800,
      canvasCssHeight: 800,
    });
    expect(clamped.originX).toBe(0);
    expect(clamped.originY).toBe(-200); // 800 - 1000
  });

  it('leaves an in-bounds pan of a larger board untouched', () => {
    const viewport = createViewport({ scale: 10, originX: -100, originY: -50 });
    const clamped = clampPan(viewport, {
      boardWidth: 100,
      boardHeight: 100,
      canvasCssWidth: 800,
      canvasCssHeight: 800,
    });
    expect(clamped.originX).toBe(-100);
    expect(clamped.originY).toBe(-50);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a boardWidth of %p', (bad) => {
    expect(() =>
      clampPan(createViewport({ scale: 10 }), {
        boardWidth: bad,
        boardHeight: 10,
        canvasCssWidth: 100,
        canvasCssHeight: 100,
      }),
    ).toThrow(RangeError);
  });

  it('holds the board on screen however pan deltas are composed, board smaller or larger than the canvas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), {
          minLength: 0,
          maxLength: 20,
        }),
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), {
          minLength: 0,
          maxLength: 20,
        }),
        (boardWidth, boardHeight, scale, dxs, dys) => {
          fc.pre(dxs.length === dys.length);
          const bounds = {
            boardWidth,
            boardHeight,
            canvasCssWidth: 800,
            canvasCssHeight: 800,
          };
          let viewport: Viewport<'css'> = clampPan(createViewport({ scale }), bounds);
          for (let i = 0; i < dxs.length; i++) {
            viewport = clampPan(panViewport(viewport, dxs[i] as number, dys[i] as number), bounds);
          }
          const boardWidthCss = boardWidth * viewport.scale;
          const boardHeightCss = boardHeight * viewport.scale;
          if (boardWidthCss <= bounds.canvasCssWidth) {
            expect(viewport.originX).toBeCloseTo((bounds.canvasCssWidth - boardWidthCss) / 2, 6);
          } else {
            expect(viewport.originX).toBeLessThanOrEqual(0);
            expect(viewport.originX).toBeGreaterThanOrEqual(bounds.canvasCssWidth - boardWidthCss);
          }
          if (boardHeightCss <= bounds.canvasCssHeight) {
            expect(viewport.originY).toBeCloseTo((bounds.canvasCssHeight - boardHeightCss) / 2, 6);
          } else {
            expect(viewport.originY).toBeLessThanOrEqual(0);
            expect(viewport.originY).toBeGreaterThanOrEqual(
              bounds.canvasCssHeight - boardHeightCss,
            );
          }
        },
      ),
    );
  });
});

describe('computeBlitRects', () => {
  it('covers the whole canvas when the board exactly fills it', () => {
    const viewport = createViewport({ scale: 10, originX: 0, originY: 0 });
    const bufferViewport = createBufferViewport(20);
    const rects = computeBlitRects(viewport, bufferViewport, 200, 200, 100, 100);
    expect(rects).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 200,
      sourceHeight: 200,
      destX: 0,
      destY: 0,
      destWidth: 100,
      destHeight: 100,
    });
  });

  it('scales the dest rect by dpr', () => {
    const viewport = createViewport({ scale: 10, originX: 0, originY: 0, dpr: 2 });
    const bufferViewport = createBufferViewport(20);
    const rects = computeBlitRects(viewport, bufferViewport, 200, 200, 100, 100);
    expect(rects).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 200,
      sourceHeight: 200,
      destX: 0,
      destY: 0,
      destWidth: 200,
      destHeight: 200,
    });
  });

  it('clips the source rect when the board is panned partly off screen', () => {
    // Board origin at CSS x=-50 (10 cells * scale 10 = 100px wide board,
    // half scrolled past the canvas's left edge).
    const viewport = createViewport({ scale: 10, originX: -50, originY: 0 });
    const bufferViewport = createBufferViewport(20); // 20 buffer px/cell
    const rects = computeBlitRects(viewport, bufferViewport, 200, 200, 100, 100);
    expect(rects).not.toBeNull();
    // The visible half of the board, cells 5..10, is buffer px 100..200.
    expect(rects?.sourceX).toBeCloseTo(100, 6);
    expect(rects?.sourceWidth).toBeCloseTo(100, 6);
    expect(rects?.destX).toBeCloseTo(0, 6);
    expect(rects?.destWidth).toBeCloseTo(50, 6);
  });

  it('is null when the viewport and the buffer do not overlap at all', () => {
    const viewport = createViewport({ scale: 10, originX: 10_000, originY: 0 });
    const bufferViewport = createBufferViewport(20);
    expect(computeBlitRects(viewport, bufferViewport, 200, 200, 100, 100)).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a bufferWidthPx of %p', (bad) => {
    expect(() =>
      computeBlitRects(createViewport({ scale: 10 }), createBufferViewport(20), bad, 200, 100, 100),
    ).toThrow(RangeError);
  });

  it('always overlaps once the viewport has gone through clampPan, whatever the board or canvas size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        (boardWidth, boardHeight, scale, originX, originY, bufferScale) => {
          const bounds = {
            boardWidth,
            boardHeight,
            canvasCssWidth: 800,
            canvasCssHeight: 800,
          };
          const viewport = clampPan(createViewport({ scale, originX, originY }), bounds);
          const bufferViewport = createBufferViewport(bufferScale);
          const bufferWidthPx = boardWidth * bufferScale;
          const bufferHeightPx = boardHeight * bufferScale;
          const rects = computeBlitRects(
            viewport,
            bufferViewport,
            bufferWidthPx,
            bufferHeightPx,
            bounds.canvasCssWidth,
            bounds.canvasCssHeight,
          );
          expect(rects).not.toBeNull();
        },
      ),
    );
  });
});

class FakeBlitCtx implements BlitContext2D<string> {
  drawImageCalls: unknown[][] = [];
  clearRectCalls: unknown[][] = [];
  clearRect(x: number, y: number, w: number, h: number): void {
    this.clearRectCalls.push([x, y, w, h]);
  }
  drawImage(
    image: string,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.drawImageCalls.push([image, sx, sy, sw, sh, dx, dy, dw, dh]);
  }
}

describe('blitStaticLayer', () => {
  it('clears then draws exactly one drawImage per call', () => {
    const ctx = new FakeBlitCtx();
    const rects = {
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 200,
      sourceHeight: 200,
      destX: 0,
      destY: 0,
      destWidth: 100,
      destHeight: 100,
    };
    blitStaticLayer(ctx, 'buffer-canvas', rects, 100, 100);
    expect(ctx.clearRectCalls).toEqual([[0, 0, 100, 100]]);
    expect(ctx.drawImageCalls).toEqual([['buffer-canvas', 0, 0, 200, 200, 0, 0, 100, 100]]);
  });

  it('still clears, but skips drawImage, when rects is null', () => {
    const ctx = new FakeBlitCtx();
    blitStaticLayer(ctx, 'buffer-canvas', null, 100, 100);
    expect(ctx.clearRectCalls).toEqual([[0, 0, 100, 100]]);
    expect(ctx.drawImageCalls).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a canvasWidthPx of %p', (bad) => {
    expect(() => blitStaticLayer(new FakeBlitCtx(), 'c', null, bad, 100)).toThrow(RangeError);
  });

  it('does exactly one drawImage call per frame across a simulated pan, never touching per-segment drawing', () => {
    const ctx = new FakeBlitCtx();
    const bufferViewport = createBufferViewport(20);
    const bufferWidthPx = 2000;
    const bufferHeightPx = 2000;
    let viewport: Viewport<'css'> = createViewport({ scale: 10 });
    const bounds = {
      boardWidth: 100,
      boardHeight: 100,
      canvasCssWidth: 800,
      canvasCssHeight: 800,
    };
    const frameCount = 30;
    for (let i = 0; i < frameCount; i++) {
      viewport = clampPan(panViewport(viewport, 7, -3), bounds);
      const rects = computeBlitRects(
        viewport,
        bufferViewport,
        bufferWidthPx,
        bufferHeightPx,
        bounds.canvasCssWidth,
        bounds.canvasCssHeight,
      );
      blitStaticLayer(ctx, 'buffer-canvas', rects, 800, 800);
    }
    expect(ctx.drawImageCalls.length).toBe(frameCount);
    expect(ctx.clearRectCalls.length).toBe(frameCount);
    // BlitContext2D exposes only clearRect/drawImage, so there is no
    // per-segment stroking surface for a pan frame to reach for at all.
  });
});
