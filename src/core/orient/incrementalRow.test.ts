import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../rng.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import type { Direction } from '../types.js';
import { segmentPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import { computeHeadCandidates } from './headOptions.js';
import { occupancyFromSegments } from './occupancy.js';
import { recomputeRow } from './incrementalRow.js';

function rowsOf(
  graph: { edgeStart: Uint32Array; edgeTarget: Uint32Array },
  segmentCount: number,
): number[][] {
  const rows: number[][] = [];
  for (let id = 1; id <= segmentCount; id++) {
    rows.push(
      Array.from(
        graph.edgeTarget.subarray(graph.edgeStart[id - 1] as number, graph.edgeStart[id] as number),
      ),
    );
  }
  return rows;
}

describe('recomputeRow: the ground-truth equivalence this optimisation depends on', () => {
  it('after any sequence of single-segment flips, every row matches a from-scratch buildBlockingGraph rebuild', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 10, max: 30 }),
        fc.integer({ min: 1, max: 60 }),
        (seed, size, flipCount) => {
          const mask = makeMask({ width: size, height: size });
          const path = makePath(mask);
          const params = { ...DEFAULT_GEN_PARAMS, gridSize: size, seed };
          const rng = createRng(seed);
          const segments = segmentPath(path, params, rng);
          const occupancy = occupancyFromSegments(segments, size, size);
          const segmentCount = segments.segStart.length - 1;
          const candidates = computeHeadCandidates(segments, size);

          const choice = new Uint32Array(segmentCount);
          const segHead = new Uint32Array(segmentCount);
          const segDir = new Uint8Array(segmentCount);
          for (let k = 0; k < segmentCount; k++) {
            const from = candidates.candStart[k] as number;
            const arity = (candidates.candStart[k + 1] as number) - from;
            choice[k] = from + rng.int(arity);
            segHead[k] = candidates.head[choice[k] as number] as number;
            segDir[k] = candidates.dir[choice[k] as number] as number;
          }

          // rows, maintained incrementally - the exact thing localSearch.ts does.
          const initial = buildBlockingGraph({
            width: size,
            height: size,
            segmentCount,
            occupancy,
            segHead,
            segDir,
          });
          const rows: Uint32Array[] = [];
          for (let id = 1; id <= segmentCount; id++) {
            rows.push(initial.edgeTarget.slice(initial.edgeStart[id - 1], initial.edgeStart[id]));
          }

          for (let step = 0; step < flipCount; step++) {
            const pick = rng.int(segmentCount);
            const from = candidates.candStart[pick] as number;
            const arity = (candidates.candStart[pick + 1] as number) - from;
            const currentLocal = (choice[pick] as number) - from;
            let nextLocal = rng.int(arity - 1); // arity is always 2 or 4 for a real segment
            if (nextLocal >= currentLocal) nextLocal++;
            choice[pick] = from + nextLocal;
            segHead[pick] = candidates.head[choice[pick]] as number;
            segDir[pick] = candidates.dir[choice[pick]] as number;

            rows[pick] = recomputeRow(
              pick + 1,
              segHead[pick],
              segDir[pick] as Direction,
              occupancy,
              size,
              size,
            );

            // One full rebuild is the ground truth for *every* row after this
            // flip - not just the one recomputeRow touched. That is the
            // actual claim the incremental update relies on: every other
            // row is provably untouched, not merely assumed to be.
            const expected = rowsOf(
              buildBlockingGraph({
                width: size,
                height: size,
                segmentCount,
                occupancy,
                segHead,
                segDir,
              }),
              segmentCount,
            );
            for (let id = 1; id <= segmentCount; id++) {
              expect(Array.from(rows[id - 1] as Uint32Array)).toEqual(expected[id - 1]);
            }
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 30_000);
});
