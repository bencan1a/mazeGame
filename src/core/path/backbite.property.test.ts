import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, parityOf, step } from '../grid.js';
import { createRng } from '../rng.js';
import type { Rng } from '../rng.js';
import type { Mask } from '../types.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { pathViolations } from '../../../test/fixtures/postconditions.js';
import { buildBackbitePath } from './backbite.js';

/**
 * A random connected subset of a halfWidth x halfHeight block grid, expanded
 * to full resolution — the same construction contour.property.test.ts uses.
 * Every full-resolution cell in a block region has degree >= 2 by
 * construction (a lone 2x2 block is already a 4-cycle), so this can never
 * accidentally produce the "more than two dead ends" infeasible case; it
 * exists to give backbite a large, varied set of irregular, mostly
 * non-2x2-tileable shapes rather than only rectangles.
 */
function randomConnectedBlocks(
  halfWidth: number,
  halfHeight: number,
  blockCount: number,
  rng: Rng,
): Uint8Array {
  const blockFull = new Uint8Array(halfWidth * halfHeight);
  const frontier: number[] = [rng.int(halfWidth * halfHeight)];
  blockFull[frontier[0] as number] = 1;
  let placed = 1;

  while (placed < blockCount && frontier.length > 0) {
    const pick = rng.int(frontier.length);
    const from = frontier[pick] as number;
    const candidates: number[] = [];
    for (const dir of DIRECTIONS) {
      const next = step(from, dir, halfWidth, halfHeight);
      if (next !== NO_CELL && blockFull[next] !== 1) candidates.push(next);
    }
    if (candidates.length === 0) {
      frontier.splice(pick, 1);
      continue;
    }
    const next = candidates[rng.int(candidates.length)] as number;
    blockFull[next] = 1;
    placed++;
    frontier.push(next);
  }
  return blockFull;
}

/**
 * Expand a block footprint to full resolution, then absorb up to
 * `holeBudget` individual cells as `unvisited` — each only if it leaves every
 * one of its neighbours with at least 2 remaining path-cell neighbours *and*
 * keeps the checkerboard balanced (`|black - white| <= 1`). A full block
 * region is always exactly balanced, so a hole is accepted only if removing it
 * would not push the imbalance past 1 — in practice, holes alternate colour.
 * Without that guard the generator emits masks with no Hamiltonian path at all
 * (three same-colour holes is an imbalance of 3), which is not a shape backbite
 * is expected to solve and so never a fair test of it. This is the shape it is
 * expected to handle: a would-be-tileable, legal region with a couple of holes
 * knocked
 * into it.
 */
function maskFromBlocksWithHoles(
  blockFull: Uint8Array,
  halfWidth: number,
  halfHeight: number,
  holeBudget: number,
  rng: Rng,
): Mask {
  const width = halfWidth * 2;
  const height = halfHeight * 2;
  const inside = new Uint8Array(width * height);
  const unvisited = new Uint8Array(width * height);
  let pathCellCount = 0;
  for (let by = 0; by < halfHeight; by++) {
    for (let bx = 0; bx < halfWidth; bx++) {
      if (blockFull[by * halfWidth + bx] !== 1) continue;
      const x0 = bx * 2;
      const y0 = by * 2;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        inside[(y0 + (dy as number)) * width + (x0 + (dx as number))] = 1;
        pathCellCount++;
      }
    }
  }

  const degree = (i: number): number => {
    let d = 0;
    for (const dir of DIRECTIONS) {
      const n = step(i, dir, width, height);
      if (n !== NO_CELL && inside[n] === 1 && unvisited[n] !== 1) d++;
    }
    return d;
  };

  let holes = 0;
  let attempts = 0;
  let blackRemoved = 0;
  let whiteRemoved = 0;
  while (holes < holeBudget && attempts < width * height) {
    attempts++;
    const i = rng.int(width * height);
    if (inside[i] !== 1 || unvisited[i] === 1) continue;

    const isBlack = parityOf(i, width) === 0;
    const nextBlackRemoved = blackRemoved + (isBlack ? 1 : 0);
    const nextWhiteRemoved = whiteRemoved + (isBlack ? 0 : 1);
    if (Math.abs(nextBlackRemoved - nextWhiteRemoved) > 1) continue;

    let safe = true;
    for (const dir of DIRECTIONS) {
      const n = step(i, dir, width, height);
      if (n !== NO_CELL && inside[n] === 1 && unvisited[n] !== 1 && degree(n) - 1 < 2) {
        safe = false;
        break;
      }
    }
    if (!safe) continue;

    unvisited[i] = 1;
    pathCellCount--;
    holes++;
    blackRemoved = nextBlackRemoved;
    whiteRemoved = nextWhiteRemoved;
  }

  return { width, height, inside, unvisited, pathCellCount };
}

describe('buildBackbitePath: property tests', () => {
  // Growth is a randomized process (see backbite.ts's file header on
  // trapping), so a handful of attempts can genuinely exhaust the move
  // budget or land on a disconnected region (an unlucky hole can sever the
  // one-cell bridge between two halves of a block shape) — that is the
  // documented, correct behaviour (AC: "reports failure rather than
  // spinning"), not a bug to eliminate. So this checks the thing that must
  // always hold — every *successful* result is a genuine Hamiltonian path —
  // and separately that failure is rare, not the norm.
  //
  // On this exact 80-case corpus (fc.sample with seed 1, fixed below) the
  // measured rate is 76/80 = 95%: 2 disconnected-by-construction masks and 2
  // that exhaust the growth budget. Forcing every move to operate at the head
  // only (deleting endpoint alternation) drops that to 67/80 = 83.75% on this
  // same corpus, so 0.9 sits with real margin below the correct rate and real
  // margin above that mutant — it has to mean something between those two
  // numbers, not just be a low bar nothing can fail.
  it('produces a Hamiltonian path over random irregular block regions, holes included, on the large majority of attempts', () => {
    const paramArb = fc.tuple(
      fc.integer({ min: 3, max: 10 }),
      fc.integer({ min: 3, max: 10 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 2 ** 30 }),
    );
    const cases = fc.sample(paramArb, { numRuns: 80, seed: 1 });

    let attempted = 0;
    let succeeded = 0;
    for (const [halfWidth, halfHeight, holeBudget, seed] of cases) {
      const growthRng = createRng(seed);
      const blockCount = 2 + growthRng.int(Math.max(1, halfWidth * halfHeight - 1));
      const blockFull = randomConnectedBlocks(halfWidth, halfHeight, blockCount, growthRng);
      const mask = maskFromBlocksWithHoles(blockFull, halfWidth, halfHeight, holeBudget, growthRng);
      if (mask.pathCellCount === 0) continue;
      attempted++;

      const result = buildBackbitePath(mask, createRng(seed + 1));
      if (!result.ok) continue;
      succeeded++;
      expect(pathViolations(result.path, mask)).toEqual([]);
    }

    expect(attempted).toBeGreaterThan(0);
    expect(succeeded / attempted).toBeGreaterThanOrEqual(0.9);
  });

  it('never throws building a path over any fixture mask, tileable or not', () => {
    const masks = [
      makeMask({ width: 2, height: 2 }),
      makeMask({ width: 5, height: 5 }),
      makeMask(['.##.', '####', '####', '.##.'].join('\n')),
      makeMask(['###', '#o#', '###'].join('\n')),
    ];
    for (const mask of masks) {
      expect(() => buildBackbitePath(mask, createRng(1))).not.toThrow();
    }
  });

  it('stays a valid, Hamiltonian path across thousands of backbite moves, checked after every one', () => {
    // Mixing moves reorder the path but never break it.
    // validateEveryMove turns the dev-mode assertion on for every
    // single move, not only the final one — an O(pathCellCount) check per
    // move, times thousands of moves, times several seeds, so this is the
    // slowest test in the file by design; the explicit timeout below is
    // generous against that, not against this test being slow by accident.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        const mask = makeMask({ width: 12, height: 12 });
        const result = buildBackbitePath(mask, createRng(seed), {
          mixingMoves: 4000,
          validateEveryMove: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.moves).toBeGreaterThanOrEqual(4000);
        expect(pathViolations(result.path, mask)).toEqual([]);
      }),
      { numRuns: 8 },
    );
  }, 20_000);
});
