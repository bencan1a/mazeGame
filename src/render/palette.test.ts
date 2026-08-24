import { describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_SIZE, paletteColor } from './palette.js';

describe('paletteColor', () => {
  it('has at least 4 hues and at most 6, per the readability requirement', () => {
    expect(PALETTE_SIZE).toBeGreaterThanOrEqual(4);
    expect(PALETTE_SIZE).toBeLessThanOrEqual(6);
  });

  it('returns a distinct colour for every index', () => {
    const colors = PALETTE.map((_, i) => paletteColor(i));
    expect(new Set(colors).size).toBe(PALETTE_SIZE);
  });

  it('matches PALETTE by index', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      expect(paletteColor(i)).toBe(PALETTE[i]);
    }
  });

  it('rejects an index outside the palette', () => {
    expect(() => paletteColor(-1)).toThrow(RangeError);
    expect(() => paletteColor(PALETTE_SIZE)).toThrow(RangeError);
  });

  it('rejects a non-integer index', () => {
    expect(() => paletteColor(1.5)).toThrow(RangeError);
    expect(() => paletteColor(Number.NaN)).toThrow(RangeError);
  });
});
