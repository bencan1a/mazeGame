import { describe, expect, it } from 'vitest';
import { maskLoops, relaxLoop, smoothLoop, smoothOutline, type Point } from './maskOutline.js';

/** `#` is inside. Rows are given top to bottom, as they read. */
function mask(rows: readonly string[]): { inside: Uint8Array; width: number; height: number } {
  const width = (rows[0] ?? '').length;
  const height = rows.length;
  const inside = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) inside[y * width + x] = row[x] === '#' ? 1 : 0;
  });
  return { inside, width, height };
}

function perimeter(loop: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] as Point;
    const b = loop[(i + 1) % loop.length] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

describe('maskLoops', () => {
  it('traces a single cell as its four corners', () => {
    const { inside, width, height } = mask(['...', '.#.', '...']);
    const loops = maskLoops(inside, width, height);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    expect(perimeter(loops[0] as Point[])).toBe(4);
  });

  it('finds nothing in an empty mask', () => {
    const { inside, width, height } = mask(['..', '..']);
    expect(maskLoops(inside, width, height)).toHaveLength(0);
  });

  it('gives a hole its own loop, wound against the outline around it', () => {
    const { inside, width, height } = mask(['####', '#..#', '#..#', '####']);
    const loops = maskLoops(inside, width, height);
    expect(loops).toHaveLength(2);
    // Shoelace: opposite signs mean opposite winding, which is what lets one
    // fill rule cut the hole out rather than fill it in.
    const areas = loops.map((loop) => {
      let sum = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i] as Point;
        const b = loop[(i + 1) % loop.length] as Point;
        sum += a.x * b.y - b.x * a.y;
      }
      return sum;
    });
    expect(Math.sign(areas[0] as number)).not.toBe(Math.sign(areas[1] as number));
  });

  it('keeps two separate regions apart', () => {
    const { inside, width, height } = mask(['#.#', '#.#']);
    expect(maskLoops(inside, width, height)).toHaveLength(2);
  });
});

describe('relaxLoop', () => {
  const square = maskLoops(...maskArgs(['##', '##']));

  it('leaves a loop too short to have a shape alone', () => {
    const tiny: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(relaxLoop(tiny, 10)).toEqual(tiny);
  });

  it('shrinks a short loop when run far past what its length needs', () => {
    const loop = square[0] as Point[];
    // Why `smoothOutline` scales its passes rather than taking a constant.
    expect(perimeter(relaxLoop(loop, 200))).toBeLessThan(perimeter(loop) * 0.5);
  });
});

describe('smoothOutline', () => {
  it('keeps a small lobe close to the size it was', () => {
    const loop = maskLoops(...maskArgs(['....', '.##.', '.##.', '....']))[0] as Point[];
    const smoothed = smoothOutline(loop);
    expect(perimeter(smoothed)).toBeGreaterThan(perimeter(loop) * 0.6);
  });

  it('keeps a long outline close to the size it was', () => {
    const rows = Array.from({ length: 24 }, (_, y) =>
      Array.from({ length: 24 }, (_, x) => (Math.hypot(x - 11.5, y - 11.5) < 11 ? '#' : '.')).join(
        '',
      ),
    );
    const loop = maskLoops(...maskArgs(rows))[0] as Point[];
    const smoothed = smoothOutline(loop);
    // A circle traced as cells has a longer perimeter than the circle itself,
    // so smoothing it shorter is the point; collapsing it is not.
    expect(perimeter(smoothed)).toBeGreaterThan(perimeter(loop) * 0.6);
    expect(perimeter(smoothed)).toBeLessThan(perimeter(loop));
  });
});

describe('smoothLoop', () => {
  it('doubles the point count each pass', () => {
    const loop: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(smoothLoop(loop, 1)).toHaveLength(8);
    expect(smoothLoop(loop, 3)).toHaveLength(32);
  });

  it('cuts the corners off a square, shortening its perimeter', () => {
    const loop: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(perimeter(smoothLoop(loop, 3))).toBeLessThan(perimeter(loop));
  });

  it('stays inside the loop it was given', () => {
    const loop: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    for (const point of smoothLoop(loop, 4)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(4);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(4);
    }
  });
});

function maskArgs(rows: readonly string[]): [Uint8Array, number, number] {
  const { inside, width, height } = mask(rows);
  return [inside, width, height];
}
