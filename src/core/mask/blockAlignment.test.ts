import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { makeMask } from '../../../test/fixtures/mask.js';
import type { Mask } from '../types.js';
import { generateBlob } from './blob.js';
import { MaskRepairError } from './errors.js';
import { classifyTiling } from '../path/tiling.js';
import { assertBlockAligned, repairMask } from './repair.js';

const seedArb = fc.integer({ min: 0, max: 1_000_000 });
const gridSizeArb = fc.integer({ min: 20, max: 100 });
const fillFractionArb = fc.double({ min: 0.05, max: 0.85, noNaN: true });
const NUM_RUNS = 80;

/**
 * Repair's own alignment check (`repairMask` calls `assertBlockAligned`
 * before returning) means a broken check would otherwise surface as the same
 * `MaskRepairError` the legitimate empty-region case already throws, and
 * disappear into `ran` staying low rather than failing loudly. Asserting on
 * the message here is what keeps that distinguishable.
 */
function attemptRepair(blob: ReturnType<typeof generateBlob>): Mask | null {
  try {
    return repairMask(blob);
  } catch (err) {
    if (err instanceof MaskRepairError) {
      expect(err.message).not.toMatch(
        /wholly on the path or wholly off it|past the last full 2x2 block|is not block-aligned/,
      );
      return null;
    }
    throw err;
  }
}

function rectAsciiWithOverride(
  width: number,
  height: number,
  overrideX: number,
  overrideY: number,
  overrideChar: '.' | 'o',
): string {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      row += x === overrideX && y === overrideY ? overrideChar : '#';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

describe('repairMask output satisfies the tiling classifier that consumes it', () => {
  it('never rejects a mask repairMask actually returned, over hundreds of random blobs', () => {
    let ran = 0;
    fc.assert(
      fc.property(seedArb, gridSizeArb, fillFractionArb, (seed, gridSize, fillFraction) => {
        const blob = generateBlob({ seed, gridSize, fillFraction });
        const mask = attemptRepair(blob);
        if (mask === null) return;
        ran++;
        expect(classifyTiling(mask).ok).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(ran).toBeGreaterThan(NUM_RUNS / 2);
  }, 20_000);
});

describe('assertBlockAligned: aligned synthetic masks pass', () => {
  it('accepts any all-inside rectangle with even width and height', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (halfWidth, halfHeight) => {
          const mask = makeMask({ width: halfWidth * 2, height: halfHeight * 2 });
          expect(() => assertBlockAligned(mask)).not.toThrow();
        },
      ),
    );
  });

  it('accepts a block that is entirely unvisited — uniformly off the path is aligned too', () => {
    const mask = makeMask(['oo', 'oo'].join('\n'));
    expect(() => assertBlockAligned(mask)).not.toThrow();
  });
});

interface KnockoutCase {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

const knockoutCaseArb: fc.Arbitrary<KnockoutCase> = fc
  .integer({ min: 1, max: 5 })
  .chain((halfWidth) =>
    fc.integer({ min: 1, max: 5 }).chain((halfHeight) =>
      fc.record({
        halfWidth: fc.constant(halfWidth),
        halfHeight: fc.constant(halfHeight),
        bx: fc.integer({ min: 0, max: halfWidth - 1 }),
        by: fc.integer({ min: 0, max: halfHeight - 1 }),
        subCell: fc.integer({ min: 0, max: 3 }),
      }),
    ),
  )
  .map(({ halfWidth, halfHeight, bx, by, subCell }) => ({
    width: halfWidth * 2,
    height: halfHeight * 2,
    x: bx * 2 + (subCell === 1 || subCell === 3 ? 1 : 0),
    y: by * 2 + (subCell === 2 || subCell === 3 ? 1 : 0),
  }));

describe('assertBlockAligned: rejects a mixed block', () => {
  it('throws MaskRepairError when exactly one cell of a 2x2 block is knocked out to outside', () => {
    fc.assert(
      fc.property(knockoutCaseArb, ({ width, height, x, y }) => {
        const mask = makeMask(rectAsciiWithOverride(width, height, x, y, '.'));
        expect(() => assertBlockAligned(mask)).toThrow(MaskRepairError);
      }),
    );
  });

  it('throws MaskRepairError when exactly one cell of a 2x2 block is knocked out to unvisited', () => {
    fc.assert(
      fc.property(knockoutCaseArb, ({ width, height, x, y }) => {
        const mask = makeMask(rectAsciiWithOverride(width, height, x, y, 'o'));
        expect(() => assertBlockAligned(mask)).toThrow(MaskRepairError);
      }),
    );
  });

  it('names the offending block and every corner cell in the error message', () => {
    const mask = makeMask(['##', '#.'].join('\n'));
    expect(() => assertBlockAligned(mask)).toThrow(
      /block \(0, 0\) at full-res origin \(0, 0\).*SE\(1, 1\)=off/,
    );
  });

  it('rejects a path cell an odd width leaves outside every block, naming its coordinate', () => {
    const inside = new Uint8Array(3 * 2).fill(1);
    const unvisited = new Uint8Array(3 * 2);
    const mask: Mask = { width: 3, height: 2, inside, unvisited, pathCellCount: 6 };
    expect(() => assertBlockAligned(mask)).toThrow(/path cell at \(2, 0\)/);
  });
});
