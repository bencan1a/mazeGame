/**
 * Proves the fix for the head/segCells ordering trap flagged in issue #10's
 * review: `docs/CONTRACTS.md` says the head is "one of the segment's two
 * endpoints", but `src/core/validate/structure.ts` enforces the stricter
 * rule that `Board.segCells` runs tail -> head, so `segHead` must equal each
 * segment's *last* cell. Picking the other endpoint as head is only correct
 * if that segment's slice is reversed before it goes into the final Board -
 * `segReversed` (headOptions.ts) says which, `assembleSegCells` applies it.
 *
 * Acyclicity tests (index.property.test.ts, localSearch.test.ts) do not
 * catch an ordering bug here: the blocking graph is unaffected by which cell
 * order a segment's own body is listed in. Only assembling a real `Board`
 * and running the actual structure gate (`validateBoard`) does.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../rng.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import type { GenParams } from '../types.js';
import { segmentPath } from '../segment/segmentPath.js';
import { buildAdjacencyGraph, colorSegments } from '../color/index.js';
import { validateBoard } from '../validate/index.js';
import { assembleSegCells } from './assembleSegCells.js';
import { buildBlockingGraph } from './blocking.js';
import { orientByLocalSearch } from './localSearch.js';
import { occupancyFromSegments } from './occupancy.js';

function paramsFor(size: number, seed: number): GenParams {
  return { ...DEFAULT_GEN_PARAMS, gridSize: size, seed };
}

describe('a Board assembled from orientByLocalSearch passes validateBoard', () => {
  it('over a range of small boards where local search reliably converges', () => {
    let converged = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 8, max: 16 }),
        (seed, size) => {
          const mask = makeMask({ width: size, height: size });
          const path = makePath(mask);
          const params = paramsFor(size, seed);
          const rng = createRng(seed);
          const segments = segmentPath(path, params, rng);
          const occupancy = occupancyFromSegments(segments, size, size);
          const segmentCount = segments.segStart.length - 1;

          const result = orientByLocalSearch(segments, occupancy, size, size, rng);
          if (!result.converged) return; // the fallback's own contract is covered by index.test.ts's mock
          converged++;

          const segCells = assembleSegCells(segments, result.segReversed);
          const blocking = buildBlockingGraph({
            width: size,
            height: size,
            segmentCount,
            occupancy,
            segHead: result.segHead,
            segDir: result.segDir,
          });
          const adjacency = buildAdjacencyGraph(occupancy, size, size, segmentCount);
          const segColor = colorSegments(adjacency, segmentCount);

          const board = {
            width: size,
            height: size,
            params,
            segmentCount,
            occupancy,
            segStart: segments.segStart,
            segCells,
            segHead: result.segHead,
            segDir: result.segDir,
            edgeStart: blocking.edgeStart,
            edgeTarget: blocking.edgeTarget,
            segColor,
          };

          expect(() => validateBoard(board, mask)).not.toThrow();
        },
      ),
      { numRuns: 60 },
    );
    expect(converged).toBeGreaterThan(0);
  }, 20_000);
});
