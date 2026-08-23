/**
 * AC #5 (issue #10): "over 500 boards, the resulting digraph is always
 * acyclic." Built against `makePath` (a boustrophedon over a full
 * rectangle), per this issue's brief - S2's Hamiltonian path (#6/#5) is a
 * different stream and not required for this stage's own contract, which
 * only promises acyclicity given *some* Hamiltonian path cut into segments.
 *
 * Reverse construction (#11) is not wired here - a stub fallback keeps
 * `orientSegments` total even on the rare board where local search's
 * iteration box expires, so this test can assert the postcondition
 * unconditionally rather than skipping boards that would need the real
 * fallback.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../rng.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { segmentPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import { occupancyFromSegments } from './occupancy.js';
import { orientSegments } from './index.js';
import { countCyclicComponents, tarjanSCC } from './tarjan.js';
import type { ReverseConstructOrienter } from './index.js';

/** Trivially-acyclic stand-in for #11: point every segment's head off the board. */
const stubFallback: ReverseConstructOrienter = (segments, _occupancy, width, height) => {
  const segmentCount = segments.segStart.length - 1;
  const segHead = new Uint32Array(segmentCount);
  const segDir = new Uint8Array(segmentCount);
  for (let k = 0; k < segmentCount; k++) {
    // Head at the top-left corner cell 0, exiting north or west: both leave
    // the grid in a single step, so the ray never crosses another segment.
    segHead[k] = 0;
    segDir[k] = width >= height ? 0 : 3;
  }
  return {
    ok: true,
    segHead,
    segDir,
    // Not exercised by this test (it only checks the blocking digraph, which
    // never reads segCells order); the round-trip structural check lives in
    // validateBoard.roundtrip.test.ts.
    segReversed: new Uint8Array(segmentCount),
    peelOrder: Uint32Array.from({ length: segmentCount }, (_, i) => i + 1),
  };
};

const boardArb = fc.record({
  size: fc.integer({ min: 4, max: 30 }),
  seed: fc.integer({ min: 1, max: 1_000_000 }),
  meanPieceLength: fc.integer({ min: 2, max: 20 }),
  pieceLengthVariance: fc.integer({ min: 0, max: 8 }),
  minStraightRun: fc.integer({ min: 1, max: 5 }),
});

describe('orientSegments property: the resulting blocking digraph is always acyclic', () => {
  it('holds over 500 boards built from makePath, with or without the fallback firing', () => {
    let sampleCount = 0;
    let fallbackCount = 0;
    let localSearchCount = 0;
    fc.assert(
      fc.property(
        boardArb,
        ({ size, seed, meanPieceLength, pieceLengthVariance, minStraightRun }) => {
          sampleCount++;
          const mask = makeMask({ width: size, height: size });
          const path = makePath(mask);
          const params = {
            ...DEFAULT_GEN_PARAMS,
            gridSize: size,
            seed,
            meanPieceLength,
            pieceLengthVariance,
            minStraightRun,
          };
          const rng = createRng(seed);
          const segments = segmentPath(path, params, rng);
          const occupancy = occupancyFromSegments(segments, size, size);
          const segmentCount = segments.segStart.length - 1;

          const result = orientSegments(segments, occupancy, size, size, rng, {
            fallback: stubFallback,
          });
          if (result.usedFallback) fallbackCount++;
          else localSearchCount++;

          const graph = buildBlockingGraph({
            width: size,
            height: size,
            segmentCount,
            occupancy,
            segHead: result.segHead,
            segDir: result.segDir,
          });
          const edgeTarget = new Uint32Array(graph.edgeTarget.length);
          for (let i = 0; i < edgeTarget.length; i++)
            edgeTarget[i] = (graph.edgeTarget[i] as number) - 1;
          const csr = { nodeCount: segmentCount, edgeStart: graph.edgeStart, edgeTarget };
          expect(countCyclicComponents(csr, tarjanSCC(csr))).toBe(0);
        },
      ),
      { numRuns: 500 },
    );
    expect(sampleCount).toBe(500);
    // Most of the 500 assertions above must come from local search's own
    // output, not the stub fallback (which is trivially acyclic by
    // construction and proves nothing about the search). Without this floor,
    // a change that made local search fail on every board would leave this
    // test green while testing only the stub.
    expect(localSearchCount).toBeGreaterThan(400);
    console.info(
      `orientSegments fallback fired ${String(fallbackCount)}/${String(sampleCount)} times ` +
        `(${String(localSearchCount)} verified local search's own output)`,
    );
  }, 60_000); // 500 boards, some hitting the full 2000-iteration box; margin for a loaded machine under coverage
});
