import { describe, expect, it } from 'vitest';
import {
  GEN_FIELDS,
  PLAY_FIELDS,
  clampNumber,
  clampToField,
  formatFixed,
  formatInt,
  formatMs,
  formatPercent,
  parseFieldInput,
  randomSeed,
  withGenField,
  withPlayField,
} from './devPanel.js';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';

const gridSizeField = GEN_FIELDS.find((f) => f.key === 'gridSize')!;
const bendField = GEN_FIELDS.find((f) => f.key === 'bendProbability')!;
const livesField = PLAY_FIELDS.find((f) => f.key === 'lives')!;

describe('clampNumber', () => {
  it('passes a value already inside the range through unchanged', () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it('clamps to the nearer bound outside the range', () => {
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(30, 0, 10)).toBe(10);
  });

  it('falls back to the minimum for a non-finite value', () => {
    expect(clampNumber(NaN, 2, 10)).toBe(2);
    expect(clampNumber(Infinity, 2, 10)).toBe(2);
  });
});

describe('clampToField', () => {
  it('rounds an integer field', () => {
    expect(clampToField(20.6, gridSizeField)).toBe(21);
  });

  it('leaves a fractional field fractional', () => {
    expect(clampToField(0.256, bendField)).toBeCloseTo(0.256);
  });

  it('clamps an integer field to its bounds before rounding', () => {
    expect(clampToField(1000, livesField)).toBe(livesField.max);
    expect(clampToField(-5, livesField)).toBe(livesField.min);
  });
});

describe('parseFieldInput', () => {
  it('parses and clamps a valid number', () => {
    expect(parseFieldInput('55', gridSizeField, DEFAULT_GEN_PARAMS.gridSize)).toBe(55);
    expect(parseFieldInput('9999', gridSizeField, DEFAULT_GEN_PARAMS.gridSize)).toBe(
      gridSizeField.max,
    );
  });

  it('falls back on empty input rather than clamping to a bound', () => {
    expect(parseFieldInput('', gridSizeField, 42)).toBe(42);
    expect(parseFieldInput('   ', gridSizeField, 42)).toBe(42);
  });

  it('falls back on unparsable input', () => {
    expect(parseFieldInput('abc', gridSizeField, 42)).toBe(42);
  });
});

describe('withGenField / withPlayField', () => {
  it('replaces only the named field, leaving the rest of GenParams untouched', () => {
    const next = withGenField(DEFAULT_GEN_PARAMS, 'gridSize', 80);
    expect(next.gridSize).toBe(80);
    expect(next.seed).toBe(DEFAULT_GEN_PARAMS.seed);
    expect(next.fillFraction).toBe(DEFAULT_GEN_PARAMS.fillFraction);
  });

  it('replaces only the named field, leaving the rest of PlayParams untouched', () => {
    const next = withPlayField(DEFAULT_PLAY_PARAMS, 'lives', 5);
    expect(next.lives).toBe(5);
    expect(next.animationDurationMs).toBe(DEFAULT_PLAY_PARAMS.animationDurationMs);
  });
});

describe('formatting', () => {
  it('formats a fixed-point number', () => {
    expect(formatFixed(0.12345, 2)).toBe('0.12');
  });

  it('formats a fraction as a percent', () => {
    expect(formatPercent(0.4567)).toBe('46%');
    expect(formatPercent(0.4567, 1)).toBe('45.7%');
  });

  it('formats milliseconds', () => {
    expect(formatMs(419.6)).toBe('420 ms');
  });

  it('formats an integer', () => {
    expect(formatInt(3.4)).toBe('3');
  });

  it('reports non-finite values as an em dash rather than NaN or Infinity', () => {
    expect(formatFixed(NaN)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
    expect(formatMs(NaN)).toBe('—');
    expect(formatInt(NaN)).toBe('—');
  });
});

describe('randomSeed', () => {
  it('stays within the unsigned 32-bit range across the domain of Math.random', () => {
    expect(randomSeed(() => 0)).toBe(0);
    expect(randomSeed(() => 0.9999999)).toBeLessThanOrEqual(0xffffffff);
  });

  it('is deterministic for an injected generator', () => {
    expect(randomSeed(() => 0.5)).toBe(randomSeed(() => 0.5));
  });
});
