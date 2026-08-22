import { describe, expect, it } from 'vitest';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../../test/fixtures/board.js';
import { buildAdjacencyGraph } from './adjacency.js';

/** Read back the CSR slice for one segment id as a plain sorted array. */
function neighboursOf(adjStart: Uint32Array, adjTarget: Uint32Array, id: number): number[] {
  const start = adjStart[id - 1] as number;
  const end = adjStart[id] as number;
  return Array.from(adjTarget.slice(start, end));
}

describe('buildAdjacencyGraph', () => {
  it('connects every pair of segments that share a cell boundary, on ACYCLIC_BOARD', () => {
    // aaaa   a and b touch along a long shared border. a and c touch at
    // bbBA   exactly one place: a's tail at (3,1) sits directly above c's
    // bbcc   (3,2) — a's top row never reaches c at all. b and c touch where
    // Cccc   b's (1,2) meets c's (2,2). So the graph is a triangle.
    const { adjStart, adjTarget } = buildAdjacencyGraph(
      ACYCLIC_BOARD.occupancy,
      ACYCLIC_BOARD.width,
      ACYCLIC_BOARD.height,
      ACYCLIC_BOARD.segmentCount,
    );
    expect(neighboursOf(adjStart, adjTarget, 1)).toEqual([2, 3]);
    expect(neighboursOf(adjStart, adjTarget, 2)).toEqual([1, 3]);
    expect(neighboursOf(adjStart, adjTarget, 3)).toEqual([1, 2]);
  });

  it('is symmetric: j in i-s slice implies i in j-s slice', () => {
    for (const board of [ACYCLIC_BOARD, TWO_CYCLE_BOARD, THREE_CYCLE_BOARD]) {
      const { adjStart, adjTarget } = buildAdjacencyGraph(
        board.occupancy,
        board.width,
        board.height,
        board.segmentCount,
      );
      for (let id = 1; id <= board.segmentCount; id++) {
        for (const other of neighboursOf(adjStart, adjTarget, id)) {
          expect(neighboursOf(adjStart, adjTarget, other)).toContain(id);
        }
      }
    }
  });

  it('never lists a segment as its own neighbour', () => {
    for (const board of [ACYCLIC_BOARD, TWO_CYCLE_BOARD, THREE_CYCLE_BOARD]) {
      const { adjStart, adjTarget } = buildAdjacencyGraph(
        board.occupancy,
        board.width,
        board.height,
        board.segmentCount,
      );
      for (let id = 1; id <= board.segmentCount; id++) {
        expect(neighboursOf(adjStart, adjTarget, id)).not.toContain(id);
      }
    }
  });

  it('dedupes a shared border into one edge, however many cells long it is', () => {
    // A long shared border produces many East/South cell-pair contacts between
    // the same two segments; the CSR slice must still list each neighbour once.
    // TWO_CYCLE_BOARD's segment 3 (c) runs the whole width under both a and b.
    const { adjStart, adjTarget } = buildAdjacencyGraph(
      TWO_CYCLE_BOARD.occupancy,
      TWO_CYCLE_BOARD.width,
      TWO_CYCLE_BOARD.height,
      TWO_CYCLE_BOARD.segmentCount,
    );
    const cNeighbours = neighboursOf(adjStart, adjTarget, 3);
    expect(cNeighbours).toEqual([...new Set(cNeighbours)]);
  });

  it('the ray-blocking direction has no bearing on adjacency', () => {
    // TWO_CYCLE_BOARD's a and b block each other (a cycle in the *blocking*
    // digraph) but do not touch on the grid at all: there is a gap between
    // them. Adjacency must not confuse the two graphs.
    const { adjStart, adjTarget } = buildAdjacencyGraph(
      TWO_CYCLE_BOARD.occupancy,
      TWO_CYCLE_BOARD.width,
      TWO_CYCLE_BOARD.height,
      TWO_CYCLE_BOARD.segmentCount,
    );
    expect(neighboursOf(adjStart, adjTarget, 1)).not.toContain(2);
    expect(neighboursOf(adjStart, adjTarget, 2)).not.toContain(1);
  });

  it('produces CSR offsets of length segmentCount + 1 that end at adjTarget.length', () => {
    for (const board of [ACYCLIC_BOARD, TWO_CYCLE_BOARD, THREE_CYCLE_BOARD]) {
      const { adjStart, adjTarget } = buildAdjacencyGraph(
        board.occupancy,
        board.width,
        board.height,
        board.segmentCount,
      );
      expect(adjStart.length).toBe(board.segmentCount + 1);
      expect(adjStart[0]).toBe(0);
      expect(adjStart[board.segmentCount]).toBe(adjTarget.length);
    }
  });
});

describe('corrupt occupancy', () => {
  it('rejects a segment id past segmentCount instead of throwing a TypeError', () => {
    // Reached from a cell that touches another segment. Unchecked this read
    // an undefined Set and threw "Cannot read properties of undefined".
    const occupancy = Uint16Array.from([1, 9, 0, 0]);
    expect(() => buildAdjacencyGraph(occupancy, 2, 2, 1)).toThrow(
      /cell 1 holds segment id 9, which is not a segment id \(1\.\.1\)/,
    );
  });

  it('rejects an isolated out-of-range id, which was silently dropped', () => {
    // Touching nothing, this produced no error and no entry - so segColor
    // came back shorter than the board's segment count.
    const occupancy = Uint16Array.from([0, 0, 0, 9]);
    expect(() => buildAdjacencyGraph(occupancy, 2, 2, 1)).toThrow(/not a segment id/);
  });
});
