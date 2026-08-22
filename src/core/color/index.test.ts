import { describe, expect, it } from 'vitest';
import { ACYCLIC_BOARD } from '../../../test/fixtures/board.js';
import { DEFAULT_PALETTE_SIZE, buildAdjacencyGraph, colorSegments } from './index.js';

/**
 * The barrel is the public surface every other stream imports through —
 * consumers should never need to reach past it into './adjacency.js' or
 * './colorSegments.js' directly. A smoke test through it catches a re-export
 * that silently goes stale.
 */
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
