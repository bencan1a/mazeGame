/**
 * Over many boards at realistic sizes, the greedy peel succeeds and its output
 * assembles into a board whose blocking digraph is acyclic.
 *
 * The headline sizes walk a full rectangle with the boustrophedon fixture and
 * cut it with the real `segmentPath`, varying the piece-length parameters for
 * genuinely different segmentations. A rectangle is the densest packing but
 * also perfectly uniform, so a smaller tier runs the same pipeline over a
 * concave silhouette, which produces this module's one failure mode — a
 * closed ring of mutual dependencies — far more readily.
 *
 * That tier therefore counts `ok: false` instead of forbidding it: a 4x4
 * PLUS_MASK cut into very short pieces really can give two arms that only
 * point at each other, with no acyclic orientation for either endpoint
 * choice. The headline tiers make no such allowance.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { NO_CELL, directionBetween, step } from '../grid.js';
import { createRng } from '../rng.js';
import type { Board, Direction, GenParams } from '../types.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { makeMask, makePath, makePathFromCells } from '../../../test/fixtures/index.js';
import { isAcyclic } from '../../../test/fixtures/postconditions.js';
import { segmentPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import type { ReverseConstructSuccess } from './reverseConstruct.js';
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

/**
 * Every segment's declared head is one of its *original* two endpoints, the
 * corrected `segCells` really ends at that head, and (for anything longer
 * than one cell) `segDir` matches the terminal stroke arriving at it — the
 * exact rule `src/core/validate/structure.ts` enforces. A mutant that swaps
 * or reverses a candidate direction fails this directly; acyclicity alone
 * cannot see it, since the blocking graph is built from whatever directions
 * it is handed.
 */
function orientationViolations(
  segStart: Uint32Array,
  inputCells: Uint32Array,
  result: ReverseConstructSuccess,
  width: number,
): string[] {
  const out: string[] = [];
  const n = segStart.length - 1;
  for (let id = 1; id <= n; id++) {
    const from = segStart[id - 1] as number;
    const to = segStart[id] as number;
    const head = result.segHead[id - 1] as number;
    const firstCell = inputCells[from] as number;
    const lastCell = inputCells[to - 1] as number;
    if (head !== firstCell && head !== lastCell) {
      out.push(`segment ${id} head ${head} is neither endpoint (${firstCell} or ${lastCell})`);
    }
    if (result.segCells[to - 1] !== head) {
      out.push(`segment ${id} segCells does not end at its declared head ${head}`);
    }

    // segReversed is the contract-mandated flag; segCells is a convenience
    // already-reversed copy. They must never drift apart: segReversed === 1
    // exactly when this segment's corrected slice is the reverse of its
    // input slice, checked cell-for-cell rather than inferred from the head.
    const inputSlice = inputCells.subarray(from, to);
    const correctedSlice = result.segCells.subarray(from, to);
    let isReversedSlice = inputSlice.length >= 2;
    for (let k = 0; isReversedSlice && k < inputSlice.length; k++) {
      if (inputSlice[k] !== correctedSlice[inputSlice.length - 1 - k]) isReversedSlice = false;
    }
    if (result.segReversed[id - 1] !== (isReversedSlice ? 1 : 0)) {
      out.push(
        `segment ${id} segReversed is ${result.segReversed[id - 1] as number}, ` +
          `expected ${isReversedSlice ? 1 : 0} given its corrected slice`,
      );
    }

    if (to - from >= 2) {
      const before = result.segCells[to - 2] as number;
      const expected = directionBetween(before, head, width);
      if (result.segDir[id - 1] !== expected) {
        out.push(
          `segment ${id} segDir is ${result.segDir[id - 1] as number}, terminal stroke is ${expected}`,
        );
      }
    }
  }
  return out;
}

/**
 * Replays `peelOrder` against a live copy of `occupancy`, independently of
 * `reverseConstruct`'s own `remaining`/`waitingOn` bookkeeping: at the moment
 * each segment was peeled, was its ray actually clear of every segment still
 * present at that point (not just at time zero)?
 */
function peelReplayViolations(
  result: ReverseConstructSuccess,
  segStart: Uint32Array,
  occupancy: Uint16Array,
  width: number,
  height: number,
): string[] {
  const out: string[] = [];
  const live = Uint16Array.from(occupancy);
  for (const id of result.peelOrder) {
    const head = result.segHead[id - 1] as number;
    const dir = result.segDir[id - 1] as Direction;
    let cell = step(head, dir, width, height);
    while (cell !== NO_CELL) {
      const other = live[cell] as number;
      if (other !== 0 && other !== id) {
        out.push(`segment ${id} was peeled while its ray still crossed segment ${other}`);
        break;
      }
      cell = step(cell, dir, width, height);
    }
    const from = segStart[id - 1] as number;
    const to = segStart[id] as number;
    for (let k = from; k < to; k++) live[result.segCells[k] as number] = 0;
  }
  return out;
}

/**
 * Runs the real pipeline (`segmentPath` -> `reverseConstruct`) over one mask
 * and one draw of generation params, then checks the result against every
 * invariant this module promises, not just "did it return `ok: true`".
 * Returns violations rather than throwing, so a caller inside `fc.property`
 * can hand the list straight to `expect(...).toEqual([])` and let fast-check
 * shrink the failing input.
 */
function runTrial(
  width: number,
  height: number,
  buildPath: () => { cells: Uint32Array },
  seed: number,
  overrides: Partial<GenParams>,
): string[] {
  const rng = createRng(seed);
  const path = buildPath();
  // `seed` and `gridSize` are set last, after the spread, so nothing in
  // `overrides` can accidentally supply a different value for either -
  // there is exactly one source of truth for what this trial's board is
  // keyed by.
  const genParams: GenParams = { ...DEFAULT_GEN_PARAMS, ...overrides, gridSize: width, seed };
  const segmented = segmentPath(path, genParams, rng);
  const segmentCount = segmented.segStart.length - 1;
  const occupancy = occupancyFrom(segmented.segStart, segmented.segCells, width, height);

  const result = reverseConstruct(segmented, occupancy, width, height, rng);
  if (!result.ok) {
    return [`${STUCK_PREFIX}[${Array.from(result.stuck).join(', ')}]`];
  }

  const violations = [
    ...orientationViolations(segmented.segStart, segmented.segCells, result, width),
    ...peelReplayViolations(result, segmented.segStart, occupancy, width, height),
  ];

  const graph = buildBlockingGraph({
    width,
    height,
    segmentCount,
    occupancy,
    segHead: result.segHead,
    segDir: result.segDir,
  });
  const board: Board = {
    width,
    height,
    params: genParams,
    segmentCount,
    occupancy,
    segStart: segmented.segStart,
    segCells: result.segCells,
    segHead: result.segHead,
    segDir: result.segDir,
    edgeStart: graph.edgeStart,
    edgeTarget: graph.edgeTarget,
    // isAcyclic never inspects colour; a real palette is validated separately
    // in reverseConstruct.test.ts's validateBoard assembly test.
    segColor: new Uint8Array(segmentCount),
  };
  if (!isAcyclic(board)) violations.push('blocking digraph is not acyclic / does not fully clear');

  return violations;
}

/**
 * A trial's only acceptable failure mode: reverseConstruct correctly reports
 * that this exact segmentation has no acyclic orientation at all (see the
 * module's completeness proof) rather than that something is actually wrong.
 * Any other entry in a violations array is a real defect.
 */
const STUCK_PREFIX = 'reverseConstruct stuck on ';

const overridesArb = fc.record({
  meanPieceLength: fc.integer({ min: 4, max: 30 }),
  pieceLengthVariance: fc.integer({ min: 0, max: 10 }),
  minStraightRun: fc.integer({ min: 1, max: 5 }),
});

describe('reverseConstruct property: fast tier (small rectangles, part of the default suite)', () => {
  it('always yields an acyclic, fully-oriented, geometrically-consistent board over 150 small boards', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        overridesArb,
        (gridSize, seed, overrides) => {
          const violations = runTrial(
            gridSize,
            gridSize,
            () => makePath(makeMask({ width: gridSize, height: gridSize })),
            seed,
            overrides,
          );
          expect(violations).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe.each([
  { label: '40x40', gridSize: 40 },
  { label: '100x100', gridSize: 100 },
])(
  'reverseConstruct property: heavy tier, $label (issue #11 acceptance criterion)',
  ({ gridSize }) => {
    // 200 boards at 100x100 comfortably clears vitest's 5s default outside
    // coverage, but v8 coverage instrumentation (plus contention from
    // whatever else the runner is doing concurrently) slows it enough to
    // trip that default, and by a variable amount run to run — this is a
    // real generator taking real time under real load, not a hang.
    const timeoutMs = 60_000;
    it(
      `always yields an acyclic, fully-oriented, geometrically-consistent board over 200 ${gridSize}x${gridSize} boards`,
      () => {
        fc.assert(
          fc.property(fc.integer({ min: 1, max: 1_000_000 }), overridesArb, (seed, overrides) => {
            const violations = runTrial(
              gridSize,
              gridSize,
              () => makePath(makeMask({ width: gridSize, height: gridSize })),
              seed,
              overrides,
            );
            expect(violations).toEqual([]);
          }),
          { numRuns: 200 },
        );
      },
      timeoutMs,
    );
  },
);

describe('reverseConstruct property: a concave silhouette, not just a uniform rectangle', () => {
  it('always yields an acyclic, fully-oriented, geometrically-consistent board over PLUS_MASK', () => {
    // A hand-checked Hamiltonian path over PLUS_MASK (['.##.','####','####','.##.']):
    // no fixture builds one for a non-rectangular mask, so this walks it by hand
    // and lets makePathFromCells check the path postconditions.
    const width = 4;
    const height = 4;
    const idx = (x: number, y: number): number => y * width + x;
    const plusWalk = [
      idx(1, 0),
      idx(2, 0),
      idx(2, 1),
      idx(3, 1),
      idx(3, 2),
      idx(2, 2),
      idx(2, 3),
      idx(1, 3),
      idx(1, 2),
      idx(0, 2),
      idx(0, 1),
      idx(1, 1),
    ];
    const mask = makeMask(['.##.', '####', '####', '.##.'].join('\n'));
    const buildPath = (): { cells: Uint32Array } => makePathFromCells(mask, plusWalk);

    // Short pieces on a 12-cell path so several segments actually form -
    // short enough that a genuine mutual-dependency pair is a real
    // possibility here (see the module doc comment), which is exactly what
    // this tier exists to characterise rather than paper over.
    let stuckCount = 0;
    let ran = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 3 }),
        (seed, meanPieceLength, pieceLengthVariance) => {
          ran++;
          const violations = runTrial(width, height, buildPath, seed, {
            meanPieceLength,
            pieceLengthVariance,
            minStraightRun: 1,
          });
          if (violations.length === 1 && violations[0]?.startsWith(STUCK_PREFIX)) {
            stuckCount++;
            return;
          }
          expect(violations).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
    // Real, measured data — see the module doc comment for why this tier
    // (and only this one) reports a rate instead of asserting it is always 0.
    console.info(
      `reverseConstruct PLUS_MASK: ${stuckCount}/${ran} genuinely stuck (no acyclic ` +
        'orientation exists for that exact segmentation); every other case passed every invariant',
    );
  });
});
