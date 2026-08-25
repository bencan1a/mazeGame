/**
 * The single public entry point: mask -> path -> cut-and-orient -> validation
 * -> colors, pure in `(seed, params)`.
 *
 * Cutting and orienting are one stage, not two: `peelSegments` only ever cuts
 * a piece it can immediately give a clear exit ray, so the blocking digraph
 * it hands back is acyclic without any search and the stage has no failure
 * mode of its own.
 *
 * The mask can be several disjoint lobes, so the path stage fills one region
 * at a time and hands the peel a single concatenated walk with the region
 * boundaries marked. Segments stay inside a region; rays cross the gaps
 * between them, which is part of the puzzle.
 *
 * What is left that can fail is `MaskRepairError`, a path stage that declines
 * (`ok: false`), and `BoardInvariantError` from validation. All three are
 * retried: derive a new internal seed and rerun the whole pipeline,
 * deterministically, up to `maxAttempts`. Anything else thrown is a fault
 * rather than a refusal, and propagates rather than being retried into a
 * `GenerationFailedError` indistinguishable from an honest one.
 */

import { createRng } from './rng.js';
import type { GenParams, Board, GenerateBoard, HamiltonianPath, Seed } from './types.js';
import { BoardInvariantError } from './types.js';
import { generateBlob, repairMask, MaskRepairError } from './mask/index.js';
import type { Mask } from './types.js';
import { buildRegionPaths } from './path/index.js';
import { peelSegments } from './segment/index.js';
import type { PeelStats } from './segment/index.js';
import { occupancyFromSegments, buildBlockingGraph } from './orient/index.js';
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
 * The retry budget covers the mask and path stages, the only two that decline,
 * and they decline independently from one internal seed to the next.
 */
export const DEFAULT_MAX_ATTEMPTS = 8;

export interface GenerateBoardOptions {
  /**
   * Run `validateBoard` after assembly. Defaults to true. There is no
   * performance case for skipping it in production; an explicit `false` is
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
  /** How much piece quality the cut-and-orient peel gave up on the winning attempt. */
  readonly peel: PeelStats;
}

export interface GenerateBoardResult {
  readonly board: Board;
  /**
   * The silhouette this board was cut from. Carried out because coverage is
   * covered cells over *inside* cells, and a `Board` records only the former.
   */
  readonly mask: Mask;
  /**
   * The walk the segments were cut from. Carried out because a `Board` records
   * each segment's own run but not where the walk continued between them, so
   * a corner at a cut is invisible to anything reading the board alone.
   */
  readonly path: HamiltonianPath;
  readonly diagnostics: GenerateBoardDiagnostics;
}

type AttemptOutcome =
  | {
      readonly ok: true;
      readonly board: Board;
      readonly mask: Mask;
      readonly path: HamiltonianPath;
      readonly peel: PeelStats;
    }
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
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    // Zero or negative skips the loop entirely and reports "exhausted 0
    // attempt(s)" with no reasons, which reads as a generation failure
    // rather than the caller error it is.
    throw new RangeError(
      `generateBoard: maxAttempts must be a positive integer, got ${maxAttempts}`,
    );
  }
  const attemptFailures: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = deriveAttemptSeed(params.seed, attempt);
    const outcome = attemptGenerate(params, seed, validate);
    if (outcome.ok) {
      return {
        board: outcome.board,
        mask: outcome.mask,
        path: outcome.path,
        diagnostics: {
          attempts: attempt + 1,
          attemptFailures: [...attemptFailures],
          peel: outcome.peel,
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
 * codebase uses, rather than a plain `seed + attempt` offset, because a plain
 * offset collides across base seeds: seed 1 attempt 1 would be byte-identical
 * to seed 2 attempt 0, so two different boards' retry sequences would overlap.
 * `createRng` already makes adjacent *seeds* decorrelate (see rng.ts); this
 * is the analogous guarantee across attempts of the same seed. Attempt 0 uses
 * the seed unmodified, so the common no-retry case is exactly
 * `createRng(params.seed)` with no extra layer to reason about.
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
  const segmentSeed = root.int(0x100000000);

  let mask: Mask;
  try {
    const blob = generateBlob({
      gridSize: params.gridSize,
      seed: blobSeed,
      fillFraction: params.fillFraction,
      lobeCount: params.lobeCount,
    });
    mask = repairMask(blob);
  } catch (err) {
    if (err instanceof MaskRepairError) return { ok: false, reason: `mask: ${err.message}` };
    throw err;
  }

  const pathResult = buildRegionPaths(mask, createRng(contourSeed), params.bendProbability);
  if (!pathResult.ok) return { ok: false, reason: `path: ${pathResult.reason}` };
  const path = pathResult.path;

  const segments = peelSegments(
    path,
    params,
    createRng(segmentSeed),
    params.gridSize,
    params.gridSize,
  );
  const occupancy = occupancyFromSegments(segments, params.gridSize, params.gridSize);
  const segmentCount = segments.segStart.length - 1;

  const { edgeStart, edgeTarget } = buildBlockingGraph({
    width: params.gridSize,
    height: params.gridSize,
    segmentCount,
    occupancy,
    segHead: segments.segHead,
    segDir: segments.segDir,
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
    segCells: segments.segCells,
    segHead: segments.segHead,
    segDir: segments.segDir,
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

  return { ok: true, board, mask, path, peel: segments.stats };
}
