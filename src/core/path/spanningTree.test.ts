import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, NO_CELL, opposite, step } from '../grid.js';
import { createRng } from '../rng.js';
import { buildSpanningTree } from './spanningTree.js';

/** Every block is a "full" (path) block, for a halfWidth x halfHeight rectangle. */
function fullRectangle(halfWidth: number, halfHeight: number): Uint8Array {
  return new Uint8Array(halfWidth * halfHeight).fill(1);
}

function countOpenEdges(open: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < open.length; i++) if (open[i] === 1) n++;
  return n;
}

describe('buildSpanningTree', () => {
  it('has exactly n-1 edges for n blocks (a tree, not a forest or a graph with a cycle)', () => {
    const halfWidth = 5;
    const halfHeight = 4;
    const blockFull = fullRectangle(halfWidth, halfHeight);
    const tree = buildSpanningTree(
      blockFull,
      halfWidth,
      halfHeight,
      createRng(1),
      blockFull.indexOf(1),
    );
    // Each edge is recorded twice (once from each endpoint), so /2 gives the edge count.
    expect(countOpenEdges(tree.open) / 2).toBe(halfWidth * halfHeight - 1);
  });

  it('is symmetric: an open edge from A to B implies an open edge back from B to A', () => {
    const halfWidth = 6;
    const halfHeight = 5;
    const blockFull = fullRectangle(halfWidth, halfHeight);
    const tree = buildSpanningTree(
      blockFull,
      halfWidth,
      halfHeight,
      createRng(42),
      blockFull.indexOf(1),
    );
    for (let block = 0; block < halfWidth * halfHeight; block++) {
      for (const dir of DIRECTIONS) {
        if (tree.open[block * 4 + dir] !== 1) continue;
        const neighbour = step(block, dir, halfWidth, halfHeight);
        expect(neighbour).not.toBe(NO_CELL);
        expect(tree.open[neighbour * 4 + opposite(dir)]).toBe(1);
      }
    }
  });

  it('connects every full block to every other, via open edges only', () => {
    const halfWidth = 7;
    const halfHeight = 6;
    const blockFull = fullRectangle(halfWidth, halfHeight);
    const tree = buildSpanningTree(
      blockFull,
      halfWidth,
      halfHeight,
      createRng(7),
      blockFull.indexOf(1),
    );

    const seen = new Uint8Array(blockFull.length);
    seen[0] = 1;
    const stack = [0];
    let count = 1;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      for (const dir of DIRECTIONS) {
        if (tree.open[cur * 4 + dir] !== 1) continue;
        const next = step(cur, dir, halfWidth, halfHeight);
        if (next === NO_CELL || seen[next] === 1) continue;
        seen[next] = 1;
        count++;
        stack.push(next);
      }
    }
    expect(count).toBe(blockFull.length);
  });

  it('never opens an edge toward a block outside the full region', () => {
    // An L-shaped block region: full blocks only in the top row and the left column.
    const halfWidth = 4;
    const halfHeight = 4;
    const blockFull = new Uint8Array(halfWidth * halfHeight);
    for (let bx = 0; bx < halfWidth; bx++) blockFull[bx] = 1; // top row
    for (let by = 0; by < halfHeight; by++) blockFull[by * halfWidth] = 1; // left column

    const tree = buildSpanningTree(
      blockFull,
      halfWidth,
      halfHeight,
      createRng(3),
      blockFull.indexOf(1),
    );
    for (let block = 0; block < blockFull.length; block++) {
      if (blockFull[block] !== 1) {
        expect(tree.open[block * 4 + 0]).toBe(0);
        expect(tree.open[block * 4 + 1]).toBe(0);
        expect(tree.open[block * 4 + 2]).toBe(0);
        expect(tree.open[block * 4 + 3]).toBe(0);
        continue;
      }
      for (const dir of DIRECTIONS) {
        if (tree.open[block * 4 + dir] !== 1) continue;
        const neighbour = step(block, dir, halfWidth, halfHeight);
        expect(neighbour).not.toBe(NO_CELL);
        expect(blockFull[neighbour]).toBe(1);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        const halfWidth = 8;
        const halfHeight = 8;
        const blockFull = fullRectangle(halfWidth, halfHeight);
        const a = buildSpanningTree(
          blockFull,
          halfWidth,
          halfHeight,
          createRng(seed),
          blockFull.indexOf(1),
        );
        const b = buildSpanningTree(
          blockFull,
          halfWidth,
          halfHeight,
          createRng(seed),
          blockFull.indexOf(1),
        );
        expect(a.open).toEqual(b.open);
      }),
      { numRuns: 20 },
    );
  });

  it('produces an empty tree for an empty region', () => {
    const halfWidth = 3;
    const halfHeight = 3;
    const blockFull = new Uint8Array(halfWidth * halfHeight);
    const tree = buildSpanningTree(
      blockFull,
      halfWidth,
      halfHeight,
      createRng(1),
      blockFull.indexOf(1),
    );
    expect(countOpenEdges(tree.open)).toBe(0);
  });

  describe('with turnBias', () => {
    it('still produces a tree with n-1 symmetric edges connecting every full block', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 10 }),
          fc.integer({ min: 2, max: 10 }),
          fc.integer({ min: 0, max: 2 ** 30 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (halfWidth, halfHeight, seed, bias) => {
            const blockFull = fullRectangle(halfWidth, halfHeight);
            const tree = buildSpanningTree(
              blockFull,
              halfWidth,
              halfHeight,
              createRng(seed),
              blockFull.indexOf(1),
              bias,
            );
            expect(countOpenEdges(tree.open) / 2).toBe(halfWidth * halfHeight - 1);

            for (let block = 0; block < halfWidth * halfHeight; block++) {
              for (const dir of DIRECTIONS) {
                if (tree.open[block * 4 + dir] !== 1) continue;
                const neighbour = step(block, dir, halfWidth, halfHeight);
                expect(neighbour).not.toBe(NO_CELL);
                expect(tree.open[neighbour * 4 + opposite(dir)]).toBe(1);
              }
            }

            const seen = new Uint8Array(blockFull.length);
            seen[0] = 1;
            const stack = [0];
            let count = 1;
            while (stack.length > 0) {
              const cur = stack.pop() as number;
              for (const dir of DIRECTIONS) {
                if (tree.open[cur * 4 + dir] !== 1) continue;
                const next = step(cur, dir, halfWidth, halfHeight);
                if (next === NO_CELL || seen[next] === 1) continue;
                seen[next] = 1;
                count++;
                stack.push(next);
              }
            }
            expect(count).toBe(blockFull.length);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('is deterministic for a given seed and bias', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 30 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (seed, bias) => {
            const halfWidth = 8;
            const halfHeight = 8;
            const blockFull = fullRectangle(halfWidth, halfHeight);
            const a = buildSpanningTree(
              blockFull,
              halfWidth,
              halfHeight,
              createRng(seed),
              blockFull.indexOf(1),
              bias,
            );
            const b = buildSpanningTree(
              blockFull,
              halfWidth,
              halfHeight,
              createRng(seed),
              blockFull.indexOf(1),
              bias,
            );
            expect(a.open).toEqual(b.open);
          },
        ),
        { numRuns: 20 },
      );
    });

    it('biases the walk toward continuing straight as bias falls toward 0', () => {
      // The fraction of non-root tree edges that carry on in the direction
      // the walk arrived from. Forced single-candidate steps count too, so
      // this never reaches 0 or 1 whatever the bias.
      const straightFraction = (bias: number, seed: number): number => {
        const halfWidth = 10;
        const halfHeight = 10;
        const blockFull = fullRectangle(halfWidth, halfHeight);
        const open = buildSpanningTree(
          blockFull,
          halfWidth,
          halfHeight,
          createRng(seed),
          blockFull.indexOf(1),
          bias,
        ).open;
        const visited = new Uint8Array(blockFull.length);
        let straight = 0;
        let decisions = 0;
        const walk = (block: number, arrivedFrom: number): void => {
          visited[block] = 1;
          for (const dir of DIRECTIONS) {
            if (open[block * 4 + dir] !== 1) continue;
            const next = step(block, dir, halfWidth, halfHeight);
            if (next === NO_CELL || visited[next] === 1) continue;
            if (arrivedFrom !== -1) {
              decisions++;
              if (dir === arrivedFrom) straight++;
            }
            walk(next, dir);
          }
        };
        walk(blockFull.indexOf(1), -1);
        return decisions > 0 ? straight / decisions : 0;
      };

      const seeds = [1, 2, 3, 4, 5];
      const meanOf = (bias: number): number =>
        seeds.reduce((sum, seed) => sum + straightFraction(bias, seed), 0) / seeds.length;

      expect(meanOf(0.05)).toBeGreaterThan(meanOf(0.95));
    });
  });
});
