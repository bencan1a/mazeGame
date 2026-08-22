import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../../test/fixtures/board.js';
import { makeMask } from '../../../test/fixtures/mask.js';
import { makePath } from '../../../test/fixtures/path.js';
import { NORTH, step } from '../grid.js';
import type { Direction } from '../types.js';
import type { BlockingGraphInput } from './blocking.js';
import { buildBlockingGraph } from './blocking.js';

describe('hand-checked fixtures (docs/CONTRACTS.md "blocking digraph")', () => {
  // These expected arrays are the ones board.test.ts asserts against
  // ACYCLIC_BOARD/TWO_CYCLE_BOARD/THREE_CYCLE_BOARD independently of any
  // ray-caster — the picture's comments explain each one by hand. Matching
  // them here is the acceptance criterion, not a derived-from-derived check:
  // board.ts's own edges come from the same fixture postconditions helper,
  // not from this module.
  it('ACYCLIC_BOARD: a -> c (south), b -> a (east), c -> nothing (west, off the board)', () => {
    const graph = buildBlockingGraph(ACYCLIC_BOARD);
    expect(Array.from(graph.edgeStart)).toEqual([0, 1, 2, 2]);
    expect(Array.from(graph.edgeTarget)).toEqual([3, 1]);
  });

  it('TWO_CYCLE_BOARD: 1 and 2 aim at each other, 3 is free', () => {
    const graph = buildBlockingGraph(TWO_CYCLE_BOARD);
    expect(Array.from(graph.edgeStart)).toEqual([0, 1, 2, 2]);
    expect(Array.from(graph.edgeTarget)).toEqual([2, 1]);
  });

  it('THREE_CYCLE_BOARD: 1 -> 2 -> 3 -> 1', () => {
    const graph = buildBlockingGraph(THREE_CYCLE_BOARD);
    expect(Array.from(graph.edgeStart)).toEqual([0, 1, 2, 3]);
    expect(Array.from(graph.edgeTarget)).toEqual([2, 3, 1]);
  });
});

describe('self-blocking is impossible', () => {
  it("skips a segment's own cells on its own ray, however many there are", () => {
    // Row of 5 cells. Segment 1 heads east from cell 0; cell 1 is also segment
    // 1's own body (a bend elsewhere in the real path folded back beside its
    // head); cell 2 is segment 2; cell 4 is empty. If self-blocking were
    // possible this would wrongly report segment 1 blocking itself.
    const input: BlockingGraphInput = {
      width: 5,
      height: 1,
      segmentCount: 2,
      occupancy: Uint16Array.from([1, 1, 2, 0, 0]),
      segHead: Uint32Array.from([0, 2]),
      segDir: Uint8Array.from([1, 1]), // both east
    };
    const graph = buildBlockingGraph(input);
    expect(rowOf(graph, 1)).toEqual([2]);
    expect(rowOf(graph, 2)).toEqual([]); // 2's ray runs off the board cleanly
  });
});

describe('duplicate blockers are de-duplicated and rows are sorted', () => {
  it('a long segment crossing the ray twice yields one edge, not two', () => {
    // Row of 6 cells: 0 is segment 1's head (east); 1 and 3 both belong to
    // segment 4 (it bends out of the row and back into it further along); 2
    // is segment 2; 4 is segment 3; 5 is empty. Encounter order is 4, 2, 4, 3
    // — segment 4 is hit twice — and 4 > 2, so the sorted requirement and the
    // de-duplication requirement are both exercised by the same ray.
    const input: BlockingGraphInput = {
      width: 6,
      height: 1,
      segmentCount: 4,
      occupancy: Uint16Array.from([1, 4, 2, 4, 3, 0]),
      segHead: Uint32Array.from([0, 2, 4, 1]),
      // Segments 2-4 point north; height is 1, so that ray leaves immediately
      // and none of them contribute edges of their own to confuse the count.
      segDir: Uint8Array.from([1, 0, 0, 0]),
    };
    const graph = buildBlockingGraph(input);
    expect(rowOf(graph, 1)).toEqual([2, 3, 4]); // sorted, and 4 appears once
    expect(rowOf(graph, 2)).toEqual([]);
    expect(rowOf(graph, 3)).toEqual([]);
    expect(rowOf(graph, 4)).toEqual([]);
  });
});

describe('CSR shape', () => {
  it('edgeStart has length n + 1 and brackets edgeTarget', () => {
    const graph = buildBlockingGraph(ACYCLIC_BOARD);
    expect(graph.edgeStart.length).toBe(ACYCLIC_BOARD.segmentCount + 1);
    expect(graph.edgeStart[0]).toBe(0);
    expect(graph.edgeStart[graph.edgeStart.length - 1]).toBe(graph.edgeTarget.length);
  });
});

describe('the step() NaN hazard (issue #38)', () => {
  it('throws instead of walking a ray forever when segDir is out of range', () => {
    // segDir is a Uint8Array: writing -1 into it silently stores 255. step()
    // answers NaN for a direction outside 0..3, and NaN !== NO_CELL, so an
    // unguarded ray walk would never terminate. buildBlockingGraph validates
    // the direction itself before stepping, rather than trusting step() (or
    // its caller) to have done so.
    const input: BlockingGraphInput = {
      width: 3,
      height: 3,
      segmentCount: 1,
      occupancy: Uint16Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0]),
      segHead: Uint32Array.from([0]),
      segDir: Uint8Array.from([255]),
    };
    expect(() => buildBlockingGraph(input)).toThrow(/segment 1 has direction 255, expected 0..3/);
  });
});

describe('property: buildBlockingGraph over arbitrary small grids', () => {
  // Random occupancy grids, random segment heads and (valid) directions. None
  // of these are realistic boards - occupancy need not form contiguous
  // segments - but buildBlockingGraph only reads occupancy, segHead and
  // segDir, and every invariant it owns must hold regardless of what put
  // those cells there.
  const arbitraryInput = fc
    .record({
      width: fc.integer({ min: 1, max: 6 }),
      height: fc.integer({ min: 1, max: 6 }),
      segmentCount: fc.integer({ min: 1, max: 5 }),
    })
    .chain(({ width, height, segmentCount }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        segmentCount: fc.constant(segmentCount),
        occupancy: fc.array(fc.integer({ min: 0, max: segmentCount }), {
          minLength: width * height,
          maxLength: width * height,
        }),
        segHead: fc.array(fc.integer({ min: 0, max: width * height - 1 }), {
          minLength: segmentCount,
          maxLength: segmentCount,
        }),
        segDir: fc.array(fc.integer({ min: 0, max: 3 }), {
          minLength: segmentCount,
          maxLength: segmentCount,
        }),
      }),
    );

  it('never produces a self-edge, a duplicate target within a row, or an unsorted row', () => {
    fc.assert(
      fc.property(arbitraryInput, ({ width, height, segmentCount, occupancy, segHead, segDir }) => {
        const input: BlockingGraphInput = {
          width,
          height,
          segmentCount,
          occupancy: Uint16Array.from(occupancy),
          segHead: Uint32Array.from(segHead),
          segDir: Uint8Array.from(segDir),
        };
        const graph = buildBlockingGraph(input);

        for (let id = 1; id <= segmentCount; id++) {
          const row = rowOf(graph, id);
          expect(row).not.toContain(id);
          expect(new Set(row).size).toBe(row.length);
          for (let k = 1; k < row.length; k++) {
            expect(row[k]).toBeGreaterThan(row[k - 1] as number);
          }
        }
      }),
    );
  });

  it('always yields a well-formed CSR: edgeStart has length n+1 and is monotonic', () => {
    fc.assert(
      fc.property(arbitraryInput, ({ width, height, segmentCount, occupancy, segHead, segDir }) => {
        const input: BlockingGraphInput = {
          width,
          height,
          segmentCount,
          occupancy: Uint16Array.from(occupancy),
          segHead: Uint32Array.from(segHead),
          segDir: Uint8Array.from(segDir),
        };
        const graph = buildBlockingGraph(input);

        expect(graph.edgeStart.length).toBe(segmentCount + 1);
        expect(graph.edgeStart[0]).toBe(0);
        expect(graph.edgeStart[segmentCount]).toBe(graph.edgeTarget.length);
        for (let id = 1; id <= segmentCount; id++) {
          expect(graph.edgeStart[id] as number).toBeGreaterThanOrEqual(
            graph.edgeStart[id - 1] as number,
          );
        }
      }),
    );
  });

  it('agrees with a direct ray walk (ground truth) up to sorting', () => {
    fc.assert(
      fc.property(arbitraryInput, ({ width, height, segmentCount, occupancy, segHead, segDir }) => {
        const input: BlockingGraphInput = {
          width,
          height,
          segmentCount,
          occupancy: Uint16Array.from(occupancy),
          segHead: Uint32Array.from(segHead),
          segDir: Uint8Array.from(segDir),
        };
        const graph = buildBlockingGraph(input);

        for (let id = 1; id <= segmentCount; id++) {
          const expected = referenceRayBlockers(input, id).sort((a, b) => a - b);
          expect(rowOf(graph, id)).toEqual(expected);
        }
      }),
    );
  });
});

/** The blockers a fresh, unsorted ray walk finds — the definition, restated independently. */
function referenceRayBlockers(input: BlockingGraphInput, id: number): number[] {
  const dir = input.segDir[id - 1] as Direction;
  const seen = new Set<number>();
  const found: number[] = [];
  let cell = step(input.segHead[id - 1] as number, dir, input.width, input.height);
  while (cell !== -1) {
    const other = input.occupancy[cell] as number;
    if (other !== 0 && other !== id && !seen.has(other)) {
      seen.add(other);
      found.push(other);
    }
    cell = step(cell, dir, input.width, input.height);
  }
  return found;
}

function rowOf(graph: { edgeStart: Uint32Array; edgeTarget: Uint32Array }, id: number): number[] {
  const from = graph.edgeStart[id - 1] as number;
  const to = graph.edgeStart[id] as number;
  const out: number[] = [];
  for (let k = from; k < to; k++) out.push(graph.edgeTarget[k] as number);
  return out;
}

describe('construction time at 100x100', () => {
  it('builds the blocking graph for a full 100x100 board well under a second', () => {
    // No segmentation stage (#8) exists yet to build this from, so this
    // synthesizes a realistic-shaped input directly: a boustrophedon path (the
    // S2 fixture, already Hamiltonian over a full rectangle) cut into
    // fixed-length chunks. 10000 cells / 20 = 500 segments, close enough to
    // DEFAULT_GEN_PARAMS.meanPieceLength for a construction-time measurement;
    // exact segment shape does not change the asymptotics this measures.
    const size = 100;
    const chunkLength = 20;
    const mask = makeMask({ width: size, height: size });
    const path = makePath(mask);
    const segmentCount = path.cells.length / chunkLength;

    const occupancy = new Uint16Array(size * size);
    const segHead = new Uint32Array(segmentCount);
    const segDir = new Uint8Array(segmentCount);
    for (let s = 0; s < segmentCount; s++) {
      const start = s * chunkLength;
      const id = s + 1;
      for (let k = 0; k < chunkLength; k++) occupancy[path.cells[start + k] as number] = id;
      const head = path.cells[start + chunkLength - 1] as number;
      segHead[s] = head;
      const before = path.cells[start + chunkLength - 2] as number;
      const dir = directionOf(before, head, size);
      segDir[s] = dir;
    }

    const input: BlockingGraphInput = {
      width: size,
      height: size,
      segmentCount,
      occupancy,
      segHead,
      segDir,
    };

    const t0 = performance.now();
    const graph = buildBlockingGraph(input);
    const elapsedMs = performance.now() - t0;

    // Recorded for the tuning phase: a headless run of this test measured
    // ~1-2ms. The generous bound below is a regression guard, not the
    // measurement to cite - see the PR/issue report for the actual number.
    console.info(
      `buildBlockingGraph 100x100 (${segmentCount} segments): ${elapsedMs.toFixed(3)}ms`,
    );
    expect(elapsedMs).toBeLessThan(1000);
    expect(graph.edgeStart.length).toBe(segmentCount + 1);
  });
});

function directionOf(from: number, to: number, width: number): Direction {
  const dx = (to % width) - (from % width);
  if (dx === 1) return 1;
  if (dx === -1) return 3;
  const dy = Math.floor(to / width) - Math.floor(from / width);
  if (dy === 1) return 2;
  if (dy === -1) return NORTH;
  throw new Error(`cells ${from} and ${to} are not 4-neighbours`);
}
