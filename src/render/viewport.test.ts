import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cell,
  cellCenterToCssPixel,
  cellCenterX,
  cellCenterY,
  cellSizeInDevicePixels,
  cellToCssPixel,
  cellToDevicePixel,
  createBufferViewport,
  createViewport,
  cssPixel,
  cssPixelToCell,
  cssPixelToDevicePixel,
  devicePixel,
  devicePixelToCell,
  devicePixelToCssPixel,
} from './viewport.js';

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
