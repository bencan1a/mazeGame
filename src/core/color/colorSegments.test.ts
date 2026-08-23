import { describe, expect, it } from 'vitest';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../../test/fixtures/board.js';
import { buildAdjacencyGraph } from './adjacency.js';
import { ColoringError, colorSegments } from './colorSegments.js';
import type { AdjacencyGraph } from './types.js';

/** Every 2-subset of a symmetric CSR clique, i.e. K_n as an adjacency graph. */
function completeGraph(n: number): AdjacencyGraph {
  const adjStart = new Uint32Array(n + 1);
  const lists: number[][] = Array.from({ length: n }, () => []);
  for (let id = 1; id <= n; id++) {
    for (let other = 1; other <= n; other++) {
      if (other !== id) (lists[id - 1] as number[]).push(other);
    }
  }
  const adjTarget = new Uint32Array(n * (n - 1));
  let at = 0;
  for (let id = 1; id <= n; id++) {
    adjStart[id - 1] = at;
    for (const target of lists[id - 1] as number[]) adjTarget[at++] = target;
  }
  adjStart[n] = at;
  return { adjStart, adjTarget };
}

/** Adjacent-segments-differ check used throughout: the property this stage exists for. */
function assertNoSharedHueAcrossEdges(adjacency: AdjacencyGraph, colors: Uint8Array): void {
  for (let id = 1; id <= colors.length; id++) {
    const start = adjacency.adjStart[id - 1] as number;
    const end = adjacency.adjStart[id] as number;
    for (let e = start; e < end; e++) {
      const other = adjacency.adjTarget[e] as number;
      expect(colors[id - 1]).not.toBe(colors[other - 1]);
    }
  }
}

describe('colorSegments', () => {
  it('gives ACYCLIC_BOARD-s triangle three distinct hues', () => {
    const adjacency = buildAdjacencyGraph(
      ACYCLIC_BOARD.occupancy,
      ACYCLIC_BOARD.width,
      ACYCLIC_BOARD.height,
      ACYCLIC_BOARD.segmentCount,
    );
    const colors = colorSegments(adjacency, ACYCLIC_BOARD.segmentCount);
    expect(colors.length).toBe(3);
    expect(new Set(colors).size).toBe(3);
    assertNoSharedHueAcrossEdges(adjacency, colors);
  });

  it('does not need to distinguish TWO_CYCLE_BOARD-s a and b: they never touch', () => {
    // The blocking digraph cycles (a <-> b), but adjacency is a different
    // graph: a and b sit either side of a gap and never share a hue
    // requirement from each other, only (each of them) from c.
    const adjacency = buildAdjacencyGraph(
      TWO_CYCLE_BOARD.occupancy,
      TWO_CYCLE_BOARD.width,
      TWO_CYCLE_BOARD.height,
      TWO_CYCLE_BOARD.segmentCount,
    );
    const colors = colorSegments(adjacency, TWO_CYCLE_BOARD.segmentCount);
    assertNoSharedHueAcrossEdges(adjacency, colors);
  });

  it('colours THREE_CYCLE_BOARD with no shared hue across a touching pair', () => {
    const adjacency = buildAdjacencyGraph(
      THREE_CYCLE_BOARD.occupancy,
      THREE_CYCLE_BOARD.width,
      THREE_CYCLE_BOARD.height,
      THREE_CYCLE_BOARD.segmentCount,
    );
    const colors = colorSegments(adjacency, THREE_CYCLE_BOARD.segmentCount);
    assertNoSharedHueAcrossEdges(adjacency, colors);
  });

  it('emits palette indices, not colours: every value is a small non-negative integer', () => {
    const adjacency = buildAdjacencyGraph(
      ACYCLIC_BOARD.occupancy,
      ACYCLIC_BOARD.width,
      ACYCLIC_BOARD.height,
      ACYCLIC_BOARD.segmentCount,
    );
    const colors = colorSegments(adjacency, ACYCLIC_BOARD.segmentCount);
    for (const color of colors) {
      expect(Number.isInteger(color)).toBe(true);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThan(6);
    }
  });

  it('an isolated segment (no neighbours) gets hue 0', () => {
    const adjacency: AdjacencyGraph = {
      adjStart: new Uint32Array([0, 0]),
      adjTarget: new Uint32Array(0),
    };
    expect(Array.from(colorSegments(adjacency, 1))).toEqual([0]);
  });

  it('returns an empty array for zero segments', () => {
    const adjacency: AdjacencyGraph = {
      adjStart: new Uint32Array([0]),
      adjTarget: new Uint32Array(0),
    };
    expect(colorSegments(adjacency, 0)).toHaveLength(0);
  });

  it('reports rather than silently reusing a hue when the palette is too small', () => {
    // K_7 needs 7 mutually-distinct colours, one more than the palette holds.
    const adjacency = completeGraph(7);
    expect(() => colorSegments(adjacency, 7)).toThrow(ColoringError);
    expect(() => colorSegments(adjacency, 7)).toThrow(/palette only holds 6/);
  });

  it('a bigger palette accepts what a smaller one must reject', () => {
    const adjacency = completeGraph(7);
    const colors = colorSegments(adjacency, 7, 7);
    assertNoSharedHueAcrossEdges(adjacency, colors);
    expect(new Set(colors).size).toBe(7);
  });

  it('rejects an adjacency graph whose CSR length does not match segmentCount', () => {
    const adjacency: AdjacencyGraph = {
      adjStart: new Uint32Array([0, 0]),
      adjTarget: new Uint32Array(0),
    };
    expect(() => colorSegments(adjacency, 5)).toThrow(ColoringError);
  });
});

describe('malformed input is rejected, not coloured badly', () => {
  /** Two segments that touch, as a well-formed graph to corrupt one field at a time. */
  function pair(): AdjacencyGraph {
    return {
      adjStart: Uint32Array.from([0, 1, 2]),
      adjTarget: Uint32Array.from([2, 1]),
    };
  }

  it('rejects a palette too large for the Uint8Array it returns', () => {
    // A colour of 256+ wraps to 0 on assignment, which can hand two touching
    // segments the same hue — the one thing this function guarantees.
    expect(() => colorSegments(pair(), 2, 300)).toThrow(
      /paletteSize must be an integer in 1\.\.256/,
    );
  });

  it.each([0, -1, 1.5, NaN])('rejects paletteSize %p', (paletteSize) => {
    expect(() => colorSegments(pair(), 2, paletteSize)).toThrow(ColoringError);
  });

  it('accepts the largest palette that still fits', () => {
    // Which of the two gets index 0 is up to the ordering; that they differ,
    // and that both fit a Uint8Array, is the guarantee.
    const colors = Array.from(colorSegments(pair(), 2, 256));
    expect(colors[0]).not.toBe(colors[1]);
    expect(Math.max(...colors)).toBeLessThan(256);
  });

  it('rejects CSR offsets that do not start at zero', () => {
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([1, 1, 2]),
      adjTarget: Uint32Array.from([2, 1]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/adjStart\[0\] is 1, expected 0/);
  });

  it('rejects CSR offsets that decrease', () => {
    // The end offset still matches adjTarget.length, so this reaches the
    // per-segment check rather than tripping the cheaper end-of-array one.
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 2, 1, 2]),
      adjTarget: Uint32Array.from([2, 3]),
    };
    expect(() => colorSegments(bad, 3)).toThrow(/decreases at segment 2/);
  });

  it('rejects CSR offsets that do not end at the target length', () => {
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 1, 1]),
      adjTarget: Uint32Array.from([2, 1]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/adjTarget has 2 entries/);
  });

  it('rejects a neighbour that is not a segment id', () => {
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 1, 2]),
      adjTarget: Uint32Array.from([9, 1]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/adjacent to 9, which is not a segment id/);
  });

  it('rejects a self-loop', () => {
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 1, 2]),
      adjTarget: Uint32Array.from([1, 1]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/segment 1 is adjacent to itself/);
  });

  it('rejects an asymmetric graph, which would hide a real adjacency', () => {
    // 1 lists 2, but 2 does not list 1 — greedy would then be free to give
    // them the same hue while they visibly touch on the board.
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 1, 1]),
      adjTarget: Uint32Array.from([2]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/not symmetric/);
  });

  it('still rejects the wrong offset length', () => {
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 1]),
      adjTarget: Uint32Array.from([2, 1]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/expected 3/);
  });
});

describe('duplicate adjacency entries', () => {
  it('rejects a neighbour listed twice, which would corrupt the ordering', () => {
    // A duplicate would double-decrement degree during peeling.
    const bad: AdjacencyGraph = {
      adjStart: Uint32Array.from([0, 2, 3]),
      adjTarget: Uint32Array.from([2, 2, 1]),
    };
    expect(() => colorSegments(bad, 2)).toThrow(/segment 1 lists segment 2 more than once/);
  });
});
