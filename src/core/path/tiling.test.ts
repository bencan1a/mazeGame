import { describe, expect, it } from 'vitest';
import { makeMask } from '../../../test/fixtures/mask.js';
import { classifyTiling } from './tiling.js';

describe('classifyTiling', () => {
  it('accepts a full rectangle with even dimensions', () => {
    const mask = makeMask({ width: 6, height: 4 });
    const result = classifyTiling(mask);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.halfWidth).toBe(3);
      expect(result.halfHeight).toBe(2);
      expect(result.blockFull).toEqual(new Uint8Array(6).fill(1));
    }
  });

  it('rejects an odd width', () => {
    const mask = makeMask({ width: 5, height: 4 });
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/even/);
  });

  it('rejects an odd height', () => {
    const mask = makeMask({ width: 4, height: 5 });
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/even/);
  });

  it('rejects any unvisited cell', () => {
    // Even dimensions, but the centre-ish cell is parity-absorbed — 4x4 keeps
    // every block homogeneous in inside/outside terms, isolating the check
    // this test wants from the block-mixing check below.
    const mask = makeMask(['####', '#oo#', '####', '####'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unvisited/);
  });

  it('rejects a block that mixes inside and outside cells', () => {
    // PLUS_MASK's top-left 2x2 corner is `.#` over `##` — three inside, one
    // outside, so no clean tiling exists despite even overall dimensions.
    const mask = makeMask(['.##.', '####', '####', '.##.'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/block at full-res/);
  });

  it('accepts a non-rectangular region built from whole 2x2 blocks', () => {
    // A plus shape drawn at block resolution (each block is 2x2), so every
    // block is either wholly inside or wholly outside.
    const mask = makeMask(
      ['..####..', '..####..', '########', '########', '..####..', '..####..'].join('\n'),
    );
    const result = classifyTiling(mask);
    expect(result.ok).toBe(true);
  });

  it('rejects two full blocks that do not touch', () => {
    const mask = makeMask(['##....', '##....', '......', '......', '....##', '....##'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not one 4-connected piece/);
  });

  it('rejects a mask with no inside cells', () => {
    const mask = makeMask(['....', '....'].join('\n'));
    const result = classifyTiling(mask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no path cells/);
  });
});
