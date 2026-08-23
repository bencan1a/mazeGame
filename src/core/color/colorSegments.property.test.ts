/**
 * Two segments that touch on the grid never share a palette index.
 *
 * The boards are synthesised by randomized multi-source flood fill, which
 * reproduces the only structure this stage reads — which regions touch which —
 * and none of segmentation's own logic.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIRECTIONS, EAST, NO_CELL, SOUTH, step } from '../grid.js';
import { createRng, shuffle } from '../rng.js';
import { buildAdjacencyGraph } from './adjacency.js';
import { colorSegments } from './colorSegments.js';

interface Tiling {
  readonly occupancy: Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly segmentCount: number;
}

/**
 * Randomized multi-source flood fill: `segmentCount` seed cells claim the
 * grid one ring at a time, in a freshly shuffled order each round, so the
 * region boundaries (and therefore the adjacency graph) vary with the seed.
 */
function buildRandomTiling(
  seed: number,
  width: number,
  height: number,
  segmentCount: number,
): Uint16Array {
  const rng = createRng(seed);
  const size = width * height;
  const occupancy = new Uint16Array(size);

  const order = shuffle(
    Array.from({ length: size }, (_, i) => i),
    rng,
  );
  const seedCells = order.slice(0, segmentCount);
  // Claim every seed cell up front. Growing outward one wave at a time before
  // every seed has claimed its own cell would let an early id's frontier
  // steal a later id's seed cell before that id ever gets to place it.
  for (let id = 1; id <= segmentCount; id++) occupancy[seedCells[id - 1] as number] = id;

  let frontier: { cell: number; id: number }[] = seedCells.map((cell, k) => ({
    cell,
    id: k + 1,
  }));

  while (frontier.length > 0) {
    shuffle(frontier, rng);
    const next: { cell: number; id: number }[] = [];
    for (const { cell, id } of frontier) {
      for (const dir of DIRECTIONS) {
        const neighbour = step(cell, dir, width, height);
        if (neighbour === NO_CELL || occupancy[neighbour] !== 0) continue;
        occupancy[neighbour] = id;
        next.push({ cell: neighbour, id });
      }
    }
    frontier = next;
  }

  return occupancy;
}

const tilingArb: fc.Arbitrary<Tiling> = fc
  .record({
    width: fc.integer({ min: 3, max: 14 }),
    height: fc.integer({ min: 3, max: 14 }),
    segmentCountRaw: fc.integer({ min: 2, max: 40 }),
    seed: fc.integer({ min: 0, max: 0x7fffffff }),
  })
  .map(({ width, height, segmentCountRaw, seed }) => {
    const segmentCount = Math.max(2, Math.min(segmentCountRaw, width * height));
    return {
      occupancy: buildRandomTiling(seed, width, height, segmentCount),
      width,
      height,
      segmentCount,
    };
  });

describe('colorSegments property: adjacent segments never share a hue', () => {
  it('holds over 500 varied randomly-tiled boards', () => {
    let sampleCount = 0;
    fc.assert(
      fc.property(tilingArb, ({ occupancy, width, height, segmentCount }) => {
        sampleCount++;
        const adjacency = buildAdjacencyGraph(occupancy, width, height, segmentCount);
        const colors = colorSegments(adjacency, segmentCount);

        // Checked against the grid rather than against buildAdjacencyGraph,
        // which would only prove the two agree with each other.
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const id = occupancy[i] as number;
            if (id === 0) continue;
            for (const dir of [EAST, SOUTH] as const) {
              const j = step(i, dir, width, height);
              if (j === NO_CELL) continue;
              const other = occupancy[j] as number;
              if (other === 0 || other === id) continue;
              expect(colors[id - 1]).not.toBe(colors[other - 1]);
            }
          }
        }
      }),
      { numRuns: 500 },
    );
    expect(sampleCount).toBe(500);
  });
});
