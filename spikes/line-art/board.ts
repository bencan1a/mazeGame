/**
 * The rest of the generator, run against a mask the spike built rather than
 * one `generateBlob` drew. Mirrors `attemptGenerate`, minus the retry loop.
 */

import { buildAdjacencyGraph, colorSegments } from '../../src/core/color/index.js';
import { computeMetrics } from '../../src/core/metrics.js';
import { buildBlockingGraph, occupancyFromSegments } from '../../src/core/orient/index.js';
import { buildRegionPaths } from '../../src/core/path/index.js';
import { createRng } from '../../src/core/rng.js';
import { peelSegments } from '../../src/core/segment/index.js';
import type { Board, BoardMetrics, GenParams, Mask } from '../../src/core/types.js';
import { validateBoard } from '../../src/core/validate/index.js';

export type BoardOutcome =
  | { readonly ok: true; readonly board: Board; readonly metrics: BoardMetrics }
  | { readonly ok: false; readonly reason: string };

export function boardFromMask(mask: Mask, params: GenParams): BoardOutcome {
  const width = mask.width;
  const height = mask.height;
  const pathResult = buildRegionPaths(mask, createRng(params.seed), params.bendProbability);
  if (!pathResult.ok) return { ok: false, reason: `path: ${pathResult.reason}` };
  const path = pathResult.path;

  const segments = peelSegments(path, params, createRng(params.seed ^ 0x5bf03635), width, height);
  const occupancy = occupancyFromSegments(segments, width, height);
  const segmentCount = segments.segStart.length - 1;
  const { edgeStart, edgeTarget } = buildBlockingGraph({
    width,
    height,
    segmentCount,
    occupancy,
    segHead: segments.segHead,
    segDir: segments.segDir,
  });

  const board: Board = {
    width,
    height,
    params,
    segmentCount,
    occupancy,
    segStart: segments.segStart,
    segCells: segments.segCells,
    segHead: segments.segHead,
    segDir: segments.segDir,
    edgeStart,
    edgeTarget,
    segColor: colorSegments(
      buildAdjacencyGraph(occupancy, width, height, segmentCount),
      segmentCount,
    ),
  };

  try {
    validateBoard(board, mask);
  } catch (err) {
    return { ok: false, reason: `validation: ${(err as Error).message}` };
  }
  return { ok: true, board, metrics: computeMetrics(board, { mask, path, generationMs: 0 }) };
}
