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
    // K_7 needs 7 mutually-distinct colours; a real board's adjacency graph is
    // planar and can never demand this, but a malformed one must fail loudly
    // rather than quietly hand back a board two adjacent pieces share a hue on.
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
