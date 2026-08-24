import { describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_SIZE, paletteColor } from './palette.js';
import { DEFAULT_PALETTE_SIZE } from '../core/color/index.js';

describe('paletteColor', () => {
  it('covers at least as many hues as the generator colours against, so a raised DEFAULT_PALETTE_SIZE cannot silently outrun it', () => {
    expect(PALETTE_SIZE).toBeGreaterThanOrEqual(DEFAULT_PALETTE_SIZE);
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
