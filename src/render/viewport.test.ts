import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cellCenterToCssPixel,
  cellSizeInDevicePixels,
  cellToCssPixel,
  cellToDevicePixel,
  createViewport,
  cssPixelToCell,
  cssPixelToDevicePixel,
  devicePixelToCell,
  devicePixelToCssPixel,
} from './viewport.js';

describe('createViewport', () => {
  it('defaults dpr to 1 and origin to (0, 0)', () => {
    const viewport = createViewport({ scale: 20 });
    expect(viewport).toEqual({ scale: 20, dpr: 1, originX: 0, originY: 0 });
  });

  it('keeps every explicit field', () => {
    const viewport = createViewport({ scale: 20, dpr: 3, originX: 5, originY: -8 });
    expect(viewport).toEqual({ scale: 20, dpr: 3, originX: 5, originY: -8 });
  });
});

describe('cellToCssPixel', () => {
  it('places cell (0, 0) at the origin', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    expect(cellToCssPixel(viewport, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
  });

  it('scales by cell distance from the origin', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    expect(cellToCssPixel(viewport, { x: 3, y: 2 })).toEqual({ x: 160, y: 90 });
  });
});

describe('cssPixelToCell', () => {
  it('inverts cellToCssPixel at a cell corner', () => {
    const viewport = createViewport({ scale: 20, originX: 100, originY: 50 });
    const corner = cellToCssPixel(viewport, { x: 3, y: 2 });
    expect(cssPixelToCell(viewport, corner)).toEqual({ x: 3, y: 2 });
  });

  it('floors toward the containing cell, not the nearest one', () => {
    const viewport = createViewport({ scale: 20 });
    expect(cssPixelToCell(viewport, { x: 39, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(cssPixelToCell(viewport, { x: 40, y: 0 })).toEqual({ x: 2, y: 0 });
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
          const cell = { x: cellX, y: cellY };
          const center = cellCenterToCssPixel(viewport, cell);
          expect(cssPixelToCell(viewport, center)).toEqual(cell);
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
          const cell = { x: cellX, y: cellY };
          const halfCellDevice = cellSizeInDevicePixels(viewport) / 2;
          const topLeftDevice = cellToDevicePixel(viewport, cell);
          const centerDevice = {
            x: topLeftDevice.x + halfCellDevice,
            y: topLeftDevice.y + halfCellDevice,
          };
          expect(devicePixelToCell(viewport, centerDevice)).toEqual(cell);
        },
      ),
    );
  });
});

describe('cssPixelToDevicePixel / devicePixelToCssPixel', () => {
  it('are inverses at a given dpr', () => {
    const viewport = createViewport({ scale: 20, dpr: 3 });
    const point = { x: 12.5, y: -4 };
    expect(devicePixelToCssPixel(viewport, cssPixelToDevicePixel(viewport, point))).toEqual(point);
  });
});

describe('cellSizeInDevicePixels', () => {
  it('multiplies scale by dpr', () => {
    expect(cellSizeInDevicePixels(createViewport({ scale: 27, dpr: 3 }))).toBe(81);
  });
});
