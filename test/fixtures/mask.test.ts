import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Mask } from '../../src/core/types.js';
import { PLUS_MASK, SQUARE_MASK, UNVISITED_MASK, makeMask, renderMask } from './mask.js';
import { maskViolations } from './postconditions.js';

/** Canonical art: no indentation, rows joined by '\n', no trailing newline. */
const canonicalArt = fc
  .record({ width: fc.integer({ min: 1, max: 8 }), height: fc.integer({ min: 1, max: 8 }) })
  .chain(({ width, height }) =>
    fc
      .array(fc.constantFrom('#', '.', 'o'), {
        minLength: width * height,
        maxLength: width * height,
      })
      .map((chars) => {
        const rows: string[] = [];
        for (let y = 0; y < height; y++) {
          rows.push(chars.slice(y * width, (y + 1) * width).join(''));
        }
        return rows.join('\n');
      }),
  );

describe('makeMask', () => {
  it('reads inside, outside and unvisited out of the art', () => {
    const mask = makeMask(['.#.', '#o#', '.#.'].join('\n'));

    expect(mask.width).toBe(3);
    expect(mask.height).toBe(3);
    expect(Array.from(mask.inside)).toEqual([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    expect(Array.from(mask.unvisited)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    // The unvisited centre is inside the silhouette but off the path.
    expect(mask.pathCellCount).toBe(4);
  });

  it('fills a rectangle spec completely', () => {
    const mask = makeMask({ width: 3, height: 2 });

    expect(Array.from(mask.inside)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(Array.from(mask.unvisited)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(mask.pathCellCount).toBe(6);
  });

  it('strips the indentation an inline template literal picks up', () => {
    const indented = `
      ##
      ##
    `;
    expect(renderMask(makeMask(indented))).toBe('##\n##');
  });

  it('rejects ragged art rather than guessing the width', () => {
    expect(() => makeMask('###\n##')).toThrow(/ragged/);
  });

  it('rejects an unknown character', () => {
    expect(() => makeMask('##\n#x')).toThrow(/unknown character/);
  });

  it('rejects a rectangle with no cells', () => {
    expect(() => makeMask({ width: 0, height: 3 })).toThrow(/positive integer/);
  });
});

describe('ascii round-trip', () => {
  it('round-trips a hand-written spec', () => {
    const spec = ['.##.', '#oo#', '####'].join('\n');
    expect(renderMask(makeMask(spec))).toBe(spec);
  });

  it('round-trips any canonical spec', () => {
    fc.assert(
      fc.property(canonicalArt, (spec) => {
        expect(renderMask(makeMask(spec))).toBe(spec);
      }),
    );
  });
});

describe('mask postconditions', () => {
  it.each([
    ['SQUARE_MASK', SQUARE_MASK],
    ['PLUS_MASK', PLUS_MASK],
    ['UNVISITED_MASK', UNVISITED_MASK],
  ])('%s satisfies the S1 contract', (_name, mask: Mask) => {
    expect(maskViolations(mask)).toEqual([]);
  });

  it('accepts every rectangle big enough to have no spurs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 2, max: 10 }),
        (width, height) => {
          expect(maskViolations(makeMask({ width, height }))).toEqual([]);
        },
      ),
    );
  });

  it('catches a mask in two pieces', () => {
    const violations = maskViolations(makeMask(['##.##', '##.##'].join('\n')));
    expect(violations).toEqual([expect.stringContaining('more than one component')]);
  });

  it('catches a one-cell-wide spur, which may have no Hamiltonian path', () => {
    const violations = maskViolations(makeMask(['#', '#', '#'].join('\n')));
    expect(violations).toEqual([
      expect.stringContaining('inside neighbour'),
      expect.stringContaining('inside neighbour'),
    ]);
  });

  it('catches checkerboard parity that absorption has not fixed', () => {
    const violations = maskViolations(makeMask(['.#.', '###', '.#.'].join('\n')));
    expect(violations).toContainEqual(expect.stringContaining('checkerboard parity is off by 3'));
  });

  it('catches more unvisited cells than absorption should ever need', () => {
    const violations = maskViolations(makeMask(['oooo', '####', '####', '####'].join('\n')));
    expect(violations).toContainEqual(expect.stringContaining('4 unvisited cells'));
  });

  it('catches an unvisited cell that is not inside', () => {
    const broken: Mask = {
      width: 2,
      height: 2,
      inside: new Uint8Array([1, 1, 1, 0]),
      unvisited: new Uint8Array([0, 0, 0, 1]),
      pathCellCount: 3,
    };
    expect(maskViolations(broken)).toContainEqual(
      expect.stringContaining('unvisited but not inside'),
    );
  });

  it('catches a pathCellCount that disagrees with the grid', () => {
    const broken: Mask = { ...makeMask({ width: 2, height: 2 }), pathCellCount: 3 };
    expect(maskViolations(broken)).toContainEqual(
      expect.stringContaining('pathCellCount is 3, counted 4'),
    );
  });
});
