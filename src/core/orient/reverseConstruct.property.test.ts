/**
 * The acceptance criterion (#11): over many boards at realistic sizes, the
 * greedy peel always succeeds, and the resulting blocking digraph is always
 * acyclic and covers every segment.
 *
 * This stream builds against fixtures rather than waiting on S1/S2's real
 * mask/path generation (docs/WORKFLOW.md), so "board" here means a full
 * rectangle mask (`makeMask`) walked by the boustrophedon fixture path
 * (`makePath`) and cut by the real `segmentPath` (this stream's own module) —
 * varying `meanPieceLength`, `pieceLengthVariance` and `minStraightRun` gives
 * genuinely different segmentations to orient, which is the only input
 * variety reverseConstruct's own correctness can depend on.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../rng.js';
import type { GenParams } from '../types.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { makeMask, makePath } from '../../../test/fixtures/index.js';
import { segmentPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import { reverseConstruct } from './reverseConstruct.js';

function occupancyFrom(
  segStart: Uint32Array,
  segCells: Uint32Array,
  width: number,
  height: number,
): Uint16Array {
  const occupancy = new Uint16Array(width * height);
  const n = segStart.length - 1;
  for (let id = 1; id <= n; id++) {
    for (let k = segStart[id - 1] as number; k < (segStart[id] as number); k++) {
      occupancy[segCells[k] as number] = id;
    }
  }
  return occupancy;
}

/** Kahn's algorithm, just enough to check acyclicity and full coverage — see reverseConstruct.test.ts. */
function isAcyclicAndFull(
  edgeStart: Uint32Array,
  edgeTarget: Uint32Array,
  segmentCount: number,
): boolean {
  const remaining = new Uint32Array(segmentCount);
  const blockedBy: number[][] = Array.from({ length: segmentCount + 1 }, () => []);
  for (let id = 1; id <= segmentCount; id++) {
    const from = edgeStart[id - 1] as number;
    const to = edgeStart[id] as number;
    remaining[id - 1] = to - from;
    for (let k = from; k < to; k++) (blockedBy[edgeTarget[k] as number] as number[]).push(id);
  }
  const queue: number[] = [];
  for (let id = 1; id <= segmentCount; id++) if (remaining[id - 1] === 0) queue.push(id);
  let cleared = 0;
  while (cleared < queue.length) {
    const id = queue[cleared] as number;
    cleared++;
    for (const waiter of blockedBy[id] as number[]) {
      remaining[waiter - 1] = (remaining[waiter - 1] as number) - 1;
      if (remaining[waiter - 1] === 0) queue.push(waiter);
    }
  }
  return cleared === segmentCount;
}

interface Trial {
  readonly gridSize: number;
  readonly seed: number;
  readonly params: Partial<GenParams>;
}

function runTrial(trial: Trial): { ok: boolean; segmentCount: number } {
  const { gridSize, seed, params } = trial;
  const rng = createRng(seed);
  const mask = makeMask({ width: gridSize, height: gridSize });
  const path = makePath(mask);
  const genParams: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize, ...params };
  const segmented = segmentPath(path, genParams, rng);
  const segmentCount = segmented.segStart.length - 1;
  const occupancy = occupancyFrom(segmented.segStart, segmented.segCells, gridSize, gridSize);

  const result = reverseConstruct(segmented, occupancy, gridSize, gridSize, rng);
  if (!result.ok) return { ok: false, segmentCount };

  const graph = buildBlockingGraph({
    width: gridSize,
    height: gridSize,
    segmentCount,
    occupancy,
    segHead: result.segHead,
    segDir: result.segDir,
  });
  const acyclicAndFull = isAcyclicAndFull(graph.edgeStart, graph.edgeTarget, segmentCount);
  return { ok: acyclicAndFull && result.peelOrder.length === segmentCount, segmentCount };
}

const trialArb = fc.record({
  seed: fc.integer({ min: 1, max: 1_000_000 }),
  meanPieceLength: fc.integer({ min: 4, max: 30 }),
  pieceLengthVariance: fc.integer({ min: 0, max: 10 }),
  minStraightRun: fc.integer({ min: 1, max: 5 }),
});

describe('reverseConstruct property: fast tier (small grids, part of the default suite)', () => {
  it('always yields an acyclic, fully-oriented board over 150 small boards', () => {
    let ran = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 20 }),
        trialArb,
        (gridSize, { seed, meanPieceLength, pieceLengthVariance, minStraightRun }) => {
          ran++;
          const { ok } = runTrial({
            gridSize,
            seed,
            params: { meanPieceLength, pieceLengthVariance, minStraightRun },
          });
          expect(ok).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
    expect(ran).toBe(150);
  });
});

describe.each([
  { label: '40x40', gridSize: 40 },
  { label: '100x100', gridSize: 100 },
])(
  'reverseConstruct property: heavy tier, $label (issue #11 acceptance criterion)',
  ({ gridSize }) => {
    // 200 boards at 100x100 comfortably clears vitest's 5s default outside
    // coverage, but v8 coverage instrumentation slows it enough to trip that
    // default — this is a real generator taking real time, not a hang.
    const timeoutMs = 30_000;
    it(
      `always yields an acyclic, fully-oriented board over 200 ${gridSize}x${gridSize} boards`,
      () => {
        let successes = 0;
        let ran = 0;
        fc.assert(
          fc.property(trialArb, (params) => {
            ran++;
            const { ok } = runTrial({ gridSize, seed: params.seed, params });
            if (ok) successes++;
            expect(ok).toBe(true);
          }),
          { numRuns: 200 },
        );
        expect(ran).toBe(200);
        // Recorded for the tuning phase and the issue report: the measured
        // success rate at this size, not just the pass/fail this test asserts.
        console.info(`reverseConstruct ${gridSize}x${gridSize}: ${successes}/${ran} succeeded`);
      },
      timeoutMs,
    );
  },
);
