import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Board } from '../types.js';
import { DEFAULT_GEN_PARAMS } from '../types.js';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../../test/fixtures/index.js';
import { createRng, shuffle } from '../rng.js';
import { greedyClear } from './greedyClear.js';

describe('greedyClear on ACYCLIC_BOARD', () => {
  // aaaa   a blocks on c (ray south from its head hits c)
  // bbBA   b blocks on a (ray east from its head hits a)
  // bbcc   c blocks on nothing (ray west leaves the board immediately)
  // Cccc   so the forced order is c, then a, then b.
  it('clears every segment in the one order its digraph allows', () => {
    const result = greedyClear(ACYCLIC_BOARD);
    expect(Array.from(result.order)).toEqual([3, 1, 2]);
    expect(Array.from(result.stuck)).toEqual([]);
  });

  it('computes depth as the length of the dependency chain ending at each segment', () => {
    const result = greedyClear(ACYCLIC_BOARD);
    // c has no blockers (depth 1); a's only blocker is c (depth 2); b's only
    // blocker is a (depth 3). Indexed by id - 1: a=0, b=1, c=2.
    expect(Array.from(result.depth)).toEqual([2, 3, 1]);
  });

  it('reports a free set of size 1 at every step of this particular board', () => {
    // Every segment here has at most one thing waiting on it, so nothing is
    // ever free alongside anything else.
    const result = greedyClear(ACYCLIC_BOARD);
    expect(Array.from(result.freeSetSizes)).toEqual([1, 1, 1]);
  });
});

describe.each([
  ['TWO_CYCLE_BOARD', TWO_CYCLE_BOARD, [1, 2]],
  ['THREE_CYCLE_BOARD', THREE_CYCLE_BOARD, [1, 2, 3]],
])('greedyClear on %s', (_name, board: Board, expectedStuck: number[]) => {
  it('stalls, leaving the cycle stuck', () => {
    const result = greedyClear(board);
    expect(result.order.length).toBeLessThan(board.segmentCount);
    expect(Array.from(result.stuck).sort()).toEqual(expectedStuck);
  });
});

describe('greedyClear as a topological sort', () => {
  it('never orders a segment before a blocker it depends on', () => {
    // Synthetic boards built from the edge CSR alone, with no real segment
    // geometry: for every edge k -> j, j must be removed before k.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 2 ** 30 }),
        (n, seed) => {
          // Segment k may only depend on a lower-numbered segment, so the graph
          // is acyclic by construction and all n must clear.
          const rng = createRng(seed);
          const perSegment: number[][] = Array.from({ length: n }, () => []);
          for (let k = 2; k <= n; k++) {
            const edgeCount = rng.int(Math.min(3, k - 1) + 1);
            const candidates = shuffle(
              Array.from({ length: k - 1 }, (_, i) => i + 1),
              rng,
            );
            for (let e = 0; e < edgeCount; e++) perSegment[k - 1]?.push(candidates[e] as number);
          }
          const board = boardFromEdges(perSegment);

          const result = greedyClear(board);
          expect(result.stuck.length).toBe(0);
          expect(result.order.length).toBe(n);

          const position = new Map(Array.from(result.order).map((id, i) => [id, i]));
          for (let k = 1; k <= n; k++) {
            for (const j of perSegment[k - 1] as number[]) {
              expect(position.get(j)).toBeLessThan(position.get(k) as number);
            }
          }
        },
      ),
    );
  });
});

/** A Board whose only real content is the blocking-edge CSR. */
function boardFromEdges(perSegment: readonly number[][]): Board {
  const n = perSegment.length;
  const edgeStart = new Uint32Array(n + 1);
  const total = perSegment.reduce((sum, targets) => sum + targets.length, 0);
  const edgeTarget = new Uint32Array(total);
  let at = 0;
  for (let id = 1; id <= n; id++) {
    edgeStart[id - 1] = at;
    for (const target of perSegment[id - 1] as number[]) edgeTarget[at++] = target;
  }
  edgeStart[n] = at;

  return {
    width: 1,
    height: n,
    // Spread the defaults: a bare literal stops compiling the moment GenParams
    // gains a required field.
    params: { ...DEFAULT_GEN_PARAMS, gridSize: n, meanPieceLength: 1, minStraightRun: 1 },
    segmentCount: n,
    occupancy: new Uint16Array(n),
    segStart: new Uint32Array(n + 1),
    segCells: new Uint32Array(n),
    segHead: new Uint32Array(n),
    segDir: new Uint8Array(n),
    edgeStart,
    edgeTarget,
    segColor: new Uint8Array(n),
  };
}
