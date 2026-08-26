import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  inkFillColor,
  inkToRgba,
  isResumeShape,
  nextIndex,
  previousIndex,
  wrapIndex,
} from './homeScreen.js';
import { PALETTE, PALETTE_SIZE } from '../render/palette.js';

describe('wrapIndex', () => {
  it('passes a value already inside the range through unchanged', () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });

  it('wraps a negative index to the end', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
  });

  it('wraps an index past the end back to the start', () => {
    expect(wrapIndex(3, 3)).toBe(0);
  });

  it('settles on 0 for a count of zero or fewer', () => {
    expect(wrapIndex(5, 0)).toBe(0);
    expect(wrapIndex(-5, -1)).toBe(0);
  });
});

describe('previousIndex / nextIndex', () => {
  it('steps back by one inside the range', () => {
    expect(previousIndex(1, 3)).toBe(0);
  });

  it('wraps from the first shape to the last', () => {
    expect(previousIndex(0, 3)).toBe(2);
  });

  it('steps forward by one inside the range', () => {
    expect(nextIndex(0, 3)).toBe(1);
  });

  it('wraps from the last shape to the first', () => {
    expect(nextIndex(2, 3)).toBe(0);
  });

  it('wraps at both ends of a single-shape library', () => {
    expect(previousIndex(0, 1)).toBe(0);
    expect(nextIndex(0, 1)).toBe(0);
  });
});

describe('isResumeShape', () => {
  it('is true only for the shape holding the save', () => {
    expect(isResumeShape('house', 'house')).toBe(true);
    expect(isResumeShape('house', 'ring')).toBe(false);
  });

  it('is false when nothing is saved', () => {
    expect(isResumeShape('house', null)).toBe(false);
  });
});

describe('hexToRgb', () => {
  it('splits a hex colour into its channels', () => {
    expect(hexToRgb('#e69f00')).toEqual({ r: 0xe6, g: 0x9f, b: 0x00 });
  });

  it('round-trips every palette colour', () => {
    for (const hex of PALETTE) {
      const { r, g, b } = hexToRgb(hex);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });
});

describe('inkFillColor', () => {
  it('picks the palette colour at the shape index', () => {
    expect(inkFillColor(0)).toBe(PALETTE[0]);
    expect(inkFillColor(1)).toBe(PALETTE[1]);
  });

  it('wraps around the palette for an index past its end', () => {
    expect(inkFillColor(PALETTE_SIZE)).toBe(PALETTE[0]);
  });
});

describe('inkToRgba', () => {
  const fill = { r: 10, g: 20, b: 30 };

  it('fills an ink-free pixel with the fill colour, opaque', () => {
    const rgba = inkToRgba(new Uint8Array([0]), fill);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255]);
  });

  it('leaves an ink pixel fully transparent', () => {
    const rgba = inkToRgba(new Uint8Array([1]), fill);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 0]);
  });

  it('maps each cell to its own four bytes, in order', () => {
    const rgba = inkToRgba(new Uint8Array([0, 1, 0]), fill);
    expect(rgba.length).toBe(12);
    expect(Array.from(rgba.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(rgba.subarray(4, 8))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.subarray(8, 12))).toEqual([10, 20, 30, 255]);
  });
});
