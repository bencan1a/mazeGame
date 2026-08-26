import { describe, expect, it } from 'vitest';
import { inkFillColor, isResumeShape, nextIndex, previousIndex, wrapIndex } from './homeScreen.js';
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

describe('inkFillColor', () => {
  it('picks the palette colour at the shape index', () => {
    expect(inkFillColor(0)).toBe(PALETTE[0]);
    expect(inkFillColor(1)).toBe(PALETTE[1]);
  });

  it('wraps around the palette for an index past its end', () => {
    expect(inkFillColor(PALETTE_SIZE)).toBe(PALETTE[0]);
  });
});
