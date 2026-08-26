import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MaskRepairError, repairMask } from '../mask/index.js';
import { DEFAULT_STROKE_WIDTH, importShape, type ShapeImportResult } from './importShape.js';

/**
 * A closed grid of `rows * cols` square faces, `cellSize` cells on a side,
 * separated by `lineThickness`-cell ink lines. The outer lines sit exactly on
 * the bitmap's own border, so the border flood never finds a non-ink seed and
 * every face is sealed by construction — no fixture in this file leaks.
 */
function gridInk(
  rows: number,
  cols: number,
  cellSize: number,
  lineThickness: number,
): { ink: Uint8Array; width: number; height: number } {
  const step = cellSize + lineThickness;
  const width = cols * step + lineThickness;
  const height = rows * step + lineThickness;
  const ink = new Uint8Array(width * height);

  for (let c = 0; c <= cols; c++) {
    const x0 = c * step;
    for (let x = x0; x < x0 + lineThickness; x++) {
      for (let y = 0; y < height; y++) ink[y * width + x] = 1;
    }
  }
  for (let r = 0; r <= rows; r++) {
    const y0 = r * step;
    for (let y = y0; y < y0 + lineThickness; y++) {
      for (let x = 0; x < width; x++) ink[y * width + x] = 1;
    }
  }

  return { ink, width, height };
}

function faceCountOf(result: ShapeImportResult): number {
  return result.ok ? result.faceCount : 0;
}

describe('importShape leak detection', () => {
  it('reports the leak case rather than returning an empty blob for an open contour', () => {
    const width = 12;
    const height = 12;
    const ink = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      ink[x] = 1;
      ink[(height - 1) * width + x] = 1;
    }
    for (let y = 0; y < height; y++) {
      ink[y * width] = 1;
      ink[y * width + width - 1] = 1;
    }
    ink[6] = 0; // gap in the top edge — the flood escapes through it

    const result = importShape({
      ink,
      sourceWidth: width,
      sourceHeight: height,
      gridSize: width,
      strokeWidth: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('leaked');
  });

  it('reports the leak case for a bitmap with no ink at all', () => {
    const result = importShape({
      ink: new Uint8Array(20 * 20),
      sourceWidth: 20,
      sourceHeight: 20,
      gridSize: 20,
    });
    expect(result).toEqual({ ok: false, reason: 'leaked' });
  });
});

describe('importShape on a closed drawing', () => {
  it('finds one face per cell of the grid fixture', () => {
    const { ink, width, height } = gridInk(2, 2, 6, 1);
    const result = importShape({
      ink,
      sourceWidth: width,
      sourceHeight: height,
      gridSize: width,
      strokeWidth: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.faceCount).toBe(4);
  });

  it('is a pure, deterministic function of its inputs', () => {
    const { ink, width, height } = gridInk(2, 2, 8, 1);
    const params = { ink, sourceWidth: width, sourceHeight: height, gridSize: 24 };
    const a = importShape(params);
    const b = importShape(params);
    expect(a).toEqual(b);
  });

  it('defaults strokeWidth to DEFAULT_STROKE_WIDTH', () => {
    const { ink, width, height } = gridInk(2, 2, 8, 1);
    const params = { ink, sourceWidth: width, sourceHeight: height, gridSize: width };
    const withDefault = importShape(params);
    const withExplicit = importShape({ ...params, strokeWidth: DEFAULT_STROKE_WIDTH });
    expect(withDefault).toEqual(withExplicit);
  });
});

describe('importShape parameter validation', () => {
  it('rejects a mismatched ink length', () => {
    expect(() =>
      importShape({ ink: new Uint8Array(10), sourceWidth: 4, sourceHeight: 4, gridSize: 20 }),
    ).toThrow();
  });

  it('rejects a non-positive or fractional gridSize', () => {
    const ink = new Uint8Array(16);
    expect(() => importShape({ ink, sourceWidth: 4, sourceHeight: 4, gridSize: 0 })).toThrow();
    expect(() => importShape({ ink, sourceWidth: 4, sourceHeight: 4, gridSize: -3 })).toThrow();
    expect(() => importShape({ ink, sourceWidth: 4, sourceHeight: 4, gridSize: 4.5 })).toThrow();
  });

  it('rejects a non-positive or fractional strokeWidth', () => {
    const ink = new Uint8Array(16);
    expect(() =>
      importShape({ ink, sourceWidth: 4, sourceHeight: 4, gridSize: 20, strokeWidth: 0 }),
    ).toThrow();
    expect(() =>
      importShape({ ink, sourceWidth: 4, sourceHeight: 4, gridSize: 20, strokeWidth: 2.5 }),
    ).toThrow();
  });
});

const rowsColsArb = fc.integer({ min: 1, max: 3 });
const cellSizeArb = fc.integer({ min: 6, max: 14 });
const lineThicknessArb = fc.integer({ min: 1, max: 2 });
const strokeWidthArb = fc.integer({ min: 1, max: 9 });

describe('importShape output is block-aligned', () => {
  it("never trips repairMask's alignment check", () => {
    fc.assert(
      fc.property(
        rowsColsArb,
        cellSizeArb,
        lineThicknessArb,
        fc.integer({ min: 10, max: 60 }),
        strokeWidthArb,
        (n, cellSize, lineThickness, gridSize, strokeWidth) => {
          const { ink, width, height } = gridInk(n, n, cellSize, lineThickness);
          const result = importShape({
            ink,
            sourceWidth: width,
            sourceHeight: height,
            gridSize,
            strokeWidth,
          });
          if (!result.ok) return;
          try {
            repairMask(result.blob);
          } catch (err) {
            // repairMask legitimately declines a too-small or too-thin
            // synthetic fixture; only its lattice-alignment complaint about
            // our own output is disallowed here.
            expect(err).toBeInstanceOf(MaskRepairError);
            expect((err as MaskRepairError).message).not.toMatch(/not block-aligned/);
          }
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe('importShape face count is monotonic in stroke width', () => {
  it('widening ink never creates faces', () => {
    fc.assert(
      fc.property(
        rowsColsArb,
        cellSizeArb,
        lineThicknessArb,
        strokeWidthArb,
        strokeWidthArb,
        (n, cellSize, lineThickness, a, b) => {
          const narrow = Math.min(a, b);
          const wide = Math.max(a, b);
          const { ink, width, height } = gridInk(n, n, cellSize, lineThickness);
          const params = { ink, sourceWidth: width, sourceHeight: height, gridSize: width };
          const atNarrow = importShape({ ...params, strokeWidth: narrow });
          const atWide = importShape({ ...params, strokeWidth: wide });
          expect(faceCountOf(atWide)).toBeLessThanOrEqual(faceCountOf(atNarrow));
        },
      ),
      { numRuns: 150 },
    );
  });
});
