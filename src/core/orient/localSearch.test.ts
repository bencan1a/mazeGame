import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../rng.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import type { GenParams } from '../types.js';
import { segmentPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import { orientByLocalSearch } from './localSearch.js';
import { occupancyFromSegments } from './occupancy.js';
import { countCyclicComponents, tarjanSCC } from './tarjan.js';

function paramsFor(size: number, overrides: Partial<GenParams> = {}): GenParams {
  return { ...DEFAULT_GEN_PARAMS, gridSize: size, ...overrides };
}

/** Whether the given segHead/segDir over `occupancy` produces an acyclic blocking digraph. */
function isAcyclic(
  occupancy: Uint16Array,
  width: number,
  height: number,
  segmentCount: number,
  segHead: Uint32Array,
  segDir: Uint8Array,
): boolean {
  const graph = buildBlockingGraph({ width, height, segmentCount, occupancy, segHead, segDir });
  const edgeTarget = new Uint32Array(graph.edgeTarget.length);
  for (let i = 0; i < edgeTarget.length; i++) edgeTarget[i] = (graph.edgeTarget[i] as number) - 1;
  const csr = { nodeCount: segmentCount, edgeStart: graph.edgeStart, edgeTarget };
  return countCyclicComponents(csr, tarjanSCC(csr)) === 0;
}

describe('orientByLocalSearch: a converged result is genuinely acyclic', () => {
  // Real generator work (mask + path + segmentation + a full local search) 40
  // times over; under v8 coverage instrumentation and next to this branch's
  // other CPU-bound property tests running concurrently, vitest's 5s default
  // is not reliably enough headroom.
  const TIMEOUT_MS = 20_000;

  it(
    'over a range of 40x40 boards built from makePath',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1_000_000 }),
          fc.integer({ min: 6, max: 24 }),
          fc.integer({ min: 1, max: 6 }),
          (seed, meanPieceLength, minStraightRun) => {
            const size = 40;
            const mask = makeMask({ width: size, height: size });
            const path = makePath(mask);
            const params = paramsFor(size, { seed, meanPieceLength, minStraightRun });
            const rng = createRng(seed);
            const segments = segmentPath(path, params, rng);
            const occupancy = occupancyFromSegments(segments, size, size);

            const result = orientByLocalSearch(segments, occupancy, size, size, rng);
            if (!result.converged) return; // fallback territory; asserted about separately

            const segmentCount = segments.segStart.length - 1;
            expect(
              isAcyclic(occupancy, size, size, segmentCount, result.segHead, result.segDir),
            ).toBe(true);
          },
        ),
        { numRuns: 40 },
      );
    },
    TIMEOUT_MS,
  );
});

describe('orientByLocalSearch: reported stats are internally consistent', () => {
  it('iterations never exceeds maxIterations, and finalSccCount is 0 iff converged', () => {
    const size = 40;
    const mask = makeMask({ width: size, height: size });
    const path = makePath(mask);
    for (const seed of [1, 2, 3, 4, 5]) {
      const params = paramsFor(size, { seed });
      const rng = createRng(seed);
      const segments = segmentPath(path, params, rng);
      const occupancy = occupancyFromSegments(segments, size, size);
      const result = orientByLocalSearch(segments, occupancy, size, size, rng, {
        maxIterations: 500,
      });
      expect(result.iterations).toBeLessThanOrEqual(500);
      expect(result.finalSccCount === 0).toBe(result.converged);
      expect(result.flips).toBe(result.iterations);
    }
  });

  it('a maxIterations of 0 never flips and reports non-convergence unless already acyclic', () => {
    const size = 20;
    const mask = makeMask({ width: size, height: size });
    const path = makePath(mask);
    const params = paramsFor(size, { seed: 7 });
    const rng = createRng(7);
    const segments = segmentPath(path, params, rng);
    const occupancy = occupancyFromSegments(segments, size, size);
    const result = orientByLocalSearch(segments, occupancy, size, size, rng, { maxIterations: 0 });
    expect(result.iterations).toBe(0);
    expect(result.flips).toBe(0);
    // "unless already acyclic": with zero flips, converged can only be true
    // if the very first random orientation happened to have no cyclic
    // component to begin with.
    expect(result.converged).toBe(result.initialSccCount === 0);
  });
});
