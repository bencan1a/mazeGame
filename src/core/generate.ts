/**
 * The single public entry point: mask -> path -> segmentation -> orientation
 * -> validation -> colors, pure in `(seed, params)`.
 *
 * A generation attempt can fail for reasons upstream stages already model as
 * data (`ok: false`) or as a thrown error (`MaskRepairError`, the "no acyclic
 * orientation exists" throw from `orientSegments`, `BoardInvariantError` from
 * validation). All four are treated as retryable: derive a new internal seed
 * and rerun the whole pipeline, deterministically, up to `maxAttempts`.
 *
 * A whole-pipeline retry is the only lever available even for a stuck
 * orientation, where retrying orientation alone provably cannot help: a
 * peeled orientation search is complete over its candidate set, so a "stuck"
 * result means no acyclic orientation exists for that exact segmentation, and
 * only a new segmentation (which a new seed produces) can change that.
 */

import { createRng } from './rng.js';
import type { GenParams, Board, GenerateBoard, Seed } from './types.js';
import { BoardInvariantError } from './types.js';
import { generateBlob, repairMask, MaskRepairError } from './mask/index.js';
import type { Mask } from './types.js';
import { buildContourPath, buildBackbitePath } from './path/index.js';
import { segmentPath } from './segment/index.js';
import {
  occupancyFromSegments,
  orientSegments,
  assembleSegCells,
  buildBlockingGraph,
} from './orient/index.js';
import { buildAdjacencyGraph, colorSegments } from './color/index.js';
import { validateBoard } from './validate/index.js';

/** Exhausting every retry attempt without a valid board. */
export class GenerationFailedError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'GenerationFailedError';
  }
}

/**
 * Retries observed empirically to clear the vast majority of seeds at every
 * documented gridSize/fillFraction combination except a mask-repair floor at
 * very small gridSize with very low fillFraction, which more retries do not
 * fix because it is geometric, not chance.
 */
export const DEFAULT_MAX_ATTEMPTS = 8;

export interface GenerateBoardOptions {
  /**
   * Run `validateBoard` after assembly. Defaults to true — its cost is a
   * small fraction of end-to-end generation time even at 100x100, so there is
   * no performance case for skipping it in production. An explicit `false` is
   * how a caller opts out, rather than `src/core/` branching on an
   * environment.
   */
  readonly validate?: boolean;
  /** Overrides `DEFAULT_MAX_ATTEMPTS`. */
  readonly maxAttempts?: number;
}

export interface GenerateBoardDiagnostics {
  /** How many internal-seed attempts it took, 1 if the first attempt succeeded. */
  readonly attempts: number;
  /** One message per failed attempt, in order, for a caller that wants to know why retries happened. */
  readonly attemptFailures: readonly string[];
  /** Whether the successful attempt's orientation fell back to reverse construction. */
  readonly usedFallbackOrientation: boolean;
}

export interface GenerateBoardResult {
  readonly board: Board;
  readonly diagnostics: GenerateBoardDiagnostics;
}

type AttemptOutcome =
  | { readonly ok: true; readonly board: Board; readonly usedFallback: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * `generateBoard` plus the retry count and per-attempt failure reasons a
 * tuning harness wants for observability. `generateBoard` below is the thin
 * `GenParams -> Board` view of this that matches the shared `GenerateBoard`
 * type.
 */
export function generateBoardWithDiagnostics(
  params: GenParams,
  options: GenerateBoardOptions = {},
): GenerateBoardResult {
  const validate = options.validate ?? true;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attemptFailures: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = deriveAttemptSeed(params.seed, attempt);
    const outcome = attemptGenerate(params, seed, validate);
    if (outcome.ok) {
      return {
        board: outcome.board,
        diagnostics: {
          attempts: attempt + 1,
          attemptFailures,
          usedFallbackOrientation: outcome.usedFallback,
        },
      };
    }
    attemptFailures.push(outcome.reason);
  }

  throw new GenerationFailedError(
    `generateBoard: exhausted ${maxAttempts} attempt(s) for seed ${params.seed} at gridSize ` +
      `${params.gridSize}, fillFraction ${params.fillFraction} without a valid board. Retrying ` +
      'further is unlikely to help: every stage here is deterministic in its seed, so a repeated ' +
      'failure across attempts is a property of the parameters rather than bad luck. The per-' +
      'attempt reasons below say which stage refused. ' +
      `Attempt failures: ${attemptFailures.join(' | ')}`,
    { params, attemptFailures },
  );
}

/** The shared `GenerateBoard` entry point: `(seed, params) -> Board`, retrying and validating internally. */
export const generateBoard: GenerateBoard = (params) => generateBoardWithDiagnostics(params).board;

/**
 * Mixes `attempt` into `seed` through the same rng primitives the rest of the
 * codebase uses, rather than a plain offset, so adjacent attempts decorrelate
 * the way adjacent seeds already do (see rng.ts). Attempt 0 uses the seed
 * unmodified, so the common no-retry case is exactly `createRng(params.seed)`
 * with no extra layer to reason about.
 */
export function deriveAttemptSeed(seed: Seed, attempt: number): Seed {
  if (attempt === 0) return seed >>> 0;
  const mixed = ((seed >>> 0) ^ Math.imul(attempt, 0x9e3779b1)) >>> 0;
  return createRng(mixed).int(0x100000000);
}

function attemptGenerate(params: GenParams, seed: Seed, validate: boolean): AttemptOutcome {
  const root = createRng(seed);
  const blobSeed = root.int(0x100000000);
  const contourSeed = root.int(0x100000000);
  const backbiteSeed = root.int(0x100000000);
  const segmentSeed = root.int(0x100000000);
  const orientSeed = root.int(0x100000000);

  let mask: Mask;
  try {
    const blob = generateBlob({
      gridSize: params.gridSize,
      seed: blobSeed,
      fillFraction: params.fillFraction,
    });
    mask = repairMask(blob);
  } catch (err) {
    if (err instanceof MaskRepairError) return { ok: false, reason: `mask: ${err.message}` };
    throw err;
  }

  const contourResult = buildContourPath(mask, createRng(contourSeed));
  const pathResult = contourResult.ok
    ? contourResult
    : buildBackbitePath(mask, createRng(backbiteSeed));
  if (!pathResult.ok) {
    const contourReason = contourResult.ok ? '' : contourResult.reason;
    return {
      ok: false,
      reason:
        `path: contour declined (${contourReason}) and backbite failed: ` +
        `${(pathResult as { reason: string }).reason}`,
    };
  }
  const path = pathResult.path;

  const segments = segmentPath(path, params, createRng(segmentSeed));
  const occupancy = occupancyFromSegments(segments, params.gridSize, params.gridSize);
  const segmentCount = segments.segStart.length - 1;

  let orientation;
  try {
    orientation = orientSegments(
      segments,
      occupancy,
      params.gridSize,
      params.gridSize,
      createRng(orientSeed),
    );
  } catch (err) {
    if (err instanceof Error) return { ok: false, reason: `orientation: ${err.message}` };
    throw err;
  }

  const segCells = assembleSegCells(segments, orientation.segReversed);
  const { edgeStart, edgeTarget } = buildBlockingGraph({
    width: params.gridSize,
    height: params.gridSize,
    segmentCount,
    occupancy,
    segHead: orientation.segHead,
    segDir: orientation.segDir,
  });
  const adjacency = buildAdjacencyGraph(occupancy, params.gridSize, params.gridSize, segmentCount);
  const segColor = colorSegments(adjacency, segmentCount);

  const board: Board = {
    width: params.gridSize,
    height: params.gridSize,
    params,
    segmentCount,
    occupancy,
    segStart: segments.segStart,
    segCells,
    segHead: orientation.segHead,
    segDir: orientation.segDir,
    edgeStart,
    edgeTarget,
    segColor,
  };

  if (validate) {
    try {
      validateBoard(board, mask);
    } catch (err) {
      if (err instanceof BoardInvariantError)
        return { ok: false, reason: `validation: ${err.message}` };
      throw err;
    }
  }

  return { ok: true, board, usedFallback: orientation.usedFallback };
}
