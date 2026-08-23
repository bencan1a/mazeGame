import { describe, expect, it } from 'vitest';
import { ACYCLIC_BOARD } from '../../../test/fixtures/board.js';
import { DEFAULT_PALETTE_SIZE, buildAdjacencyGraph, colorSegments } from './index.js';

/** Covers the barrel itself: most tests import the modules behind it directly. */
describe('the color barrel', () => {
  it('re-exports a working pipeline', () => {
    const adjacency = buildAdjacencyGraph(
      ACYCLIC_BOARD.occupancy,
      ACYCLIC_BOARD.width,
      ACYCLIC_BOARD.height,
      ACYCLIC_BOARD.segmentCount,
    );
    const colors = colorSegments(adjacency, ACYCLIC_BOARD.segmentCount);
    expect(colors).toHaveLength(ACYCLIC_BOARD.segmentCount);
    expect(DEFAULT_PALETTE_SIZE).toBe(6);
  });
});
