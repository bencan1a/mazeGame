import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIRECTIONS,
  NO_CELL,
  DIRECTION_NAMES,
  EAST,
  NORTH,
  SOUTH,
  WEST,
  directionBetween,
  isBorder,
  opposite,
  parityOf,
  step,
  stepsToEdge,
  toIndex,
  xOf,
  yOf,
} from './grid.js';
import type { Direction } from './types.js';

const W = 7;
const H = 5;

describe('index arithmetic', () => {
  it('round-trips x/y through the index', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: W - 1 }),
        fc.integer({ min: 0, max: H - 1 }),
        (x, y) => {
          const i = toIndex(x, y, W);
          expect(xOf(i, W)).toBe(x);
          expect(yOf(i, W)).toBe(y);
        },
      ),
    );
  });

  it('names every direction', () => {
    expect(DIRECTION_NAMES).toEqual(['N', 'E', 'S', 'W']);
    expect(DIRECTIONS).toEqual([NORTH, EAST, SOUTH, WEST]);
  });

  it('opposite is an involution that never fixes a point', () => {
    for (const d of DIRECTIONS) {
      expect(opposite(d)).not.toBe(d);
      expect(opposite(opposite(d))).toBe(d);
    }
  });
});

describe('step', () => {
  it('does not wrap across a row boundary', () => {
    // The bug this guards: (index - 1) at x === 0 lands on the previous row.
    expect(step(toIndex(0, 2, W), WEST, W, H)).toBe(-1);
    expect(step(toIndex(W - 1, 2, W), EAST, W, H)).toBe(-1);
    expect(step(toIndex(3, 0, W), NORTH, W, H)).toBe(-1);
    expect(step(toIndex(3, H - 1, W), SOUTH, W, H)).toBe(-1);
  });

  it('is reversible inside the grid', () => {
    for (let i = 0; i < W * H; i++) {
      for (const d of DIRECTIONS) {
        const next = step(i, d, W, H);
        if (next === -1) continue;
        expect(step(next, opposite(d), W, H)).toBe(i);
        expect(directionBetween(i, next, W)).toBe(d);
      }
    }
  });
});

describe('directionBetween', () => {
  it('rejects non-neighbours', () => {
    expect(directionBetween(toIndex(0, 0, W), toIndex(2, 0, W), W)).toBe(-1);
    expect(directionBetween(toIndex(0, 0, W), toIndex(1, 1, W), W)).toBe(-1);
    expect(directionBetween(toIndex(0, 0, W), toIndex(0, 0, W), W)).toBe(-1);
  });
});

describe('parityOf', () => {
  it('alternates between 4-neighbours', () => {
    for (let i = 0; i < W * H; i++) {
      for (const d of DIRECTIONS) {
        const next = step(i, d, W, H);
        if (next === -1) continue;
        expect(parityOf(next, W)).not.toBe(parityOf(i, W));
      }
    }
  });
});

describe('isBorder', () => {
  it('marks exactly the outer ring', () => {
    let count = 0;
    for (let i = 0; i < W * H; i++) if (isBorder(i, W, H)) count++;
    expect(count).toBe(W * H - (W - 2) * (H - 2));
  });
});

describe('stepsToEdge', () => {
  it('counts the cells a ray crosses before leaving the board', () => {
    const i = toIndex(2, 3, W);
    expect(stepsToEdge(i, NORTH, W, H)).toBe(3);
    expect(stepsToEdge(i, SOUTH, W, H)).toBe(H - 1 - 3);
    expect(stepsToEdge(i, WEST, W, H)).toBe(2);
    expect(stepsToEdge(i, EAST, W, H)).toBe(W - 1 - 2);
  });

  it('agrees with walking the ray one step at a time', () => {
    for (let i = 0; i < W * H; i++) {
      for (const d of DIRECTIONS) {
        let walked = 0;
        let cur: number = i;
        for (;;) {
          const next = step(cur, d, W, H);
          if (next === -1) break;
          cur = next;
          walked++;
        }
        expect(stepsToEdge(i, d, W, H)).toBe(walked);
      }
    }
  });
});

describe('directions that survive past the type system', () => {
  // Direction is 0|1|2|3, but it reaches Board.segDir as a Uint8Array, where the
  // type is gone: a -1 written there arrives as 255. These are the values that
  // actually turn up, not hypothetical ones.
  const OUT_OF_RANGE = [-1, 4, 255, 1.5, NaN];

  it('leaves the grid for any direction that is not 0..3', () => {
    for (const dir of OUT_OF_RANGE) {
      expect(step(12, dir as Direction, W, H)).toBe(NO_CELL);
    }
  });

  it('never answers NaN, which no NO_CELL comparison would catch', () => {
    for (const dir of OUT_OF_RANGE) {
      expect(Number.isNaN(step(12, dir as Direction, W, H))).toBe(false);
    }
  });

  it('terminates a ray walk instead of spinning on it', () => {
    let cell = step(12, 255 as Direction, W, H);
    let guard = 0;
    while (cell !== NO_CELL && guard < 1000) {
      cell = step(cell, 255 as Direction, W, H);
      guard++;
    }
    expect(guard).toBe(0);
  });

  it('reports no distance to the edge for a direction that is not 0..3', () => {
    for (const dir of OUT_OF_RANGE) {
      expect(stepsToEdge(12, dir as Direction, W, H)).toBe(NO_CELL);
    }
  });
});
