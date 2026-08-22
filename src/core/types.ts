/**
 * Shared vocabulary for the whole generator pipeline.
 *
 * Every stage in `mask -> path -> segmentation -> orientation -> validation -> colors`
 * consumes and produces types declared here. Streams working in parallel code
 * against this file and nothing else, so a change here is a cross-stream change:
 * it needs a `contract-change` issue and human review (see docs/WORKFLOW.md).
 *
 * Layout conventions that the whole codebase depends on:
 *   - A cell index is `y * width + x`. There is no {x, y} object anywhere hot.
 *   - Segment ids are 1-based. Id 0 in `occupancy` means "empty cell".
 *   - Directions are 0=North(-y) 1=East(+x) 2=South(+y) 3=West(-x).
 */

/** `y * width + x`. */
export type CellIndex = number;

/** 1-based. 0 is reserved for "no segment". */
export type SegmentId = number;

/** 0=N, 1=E, 2=S, 3=W. See DIRECTIONS in grid.ts. */
export type Direction = 0 | 1 | 2 | 3;

/** Unsigned 32-bit. */
export type Seed = number;

/**
 * The complete input to the generator. A board is a pure function of this
 * object and nothing else (ADR-0004).
 */
export interface GenParams {
  /** Square board edge length, 20..100. */
  readonly gridSize: number;
  readonly seed: Seed;
  /** Target mean segment length in cells. */
  readonly meanPieceLength: number;
  /** Spread of the segment-length distribution, in cells (std-dev-like). */
  readonly pieceLengthVariance: number;
  /** 0..1 target bend rate for the space-filling path. See R1. */
  readonly bendProbability: number;
  /** A cut may not leave a straight run shorter than this. */
  readonly minStraightRun: number;
}

/** Gameplay knobs that do not affect board generation. */
export interface PlayParams {
  readonly lives: number;
  readonly animationDurationMs: number;
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  gridSize: 40,
  seed: 1,
  meanPieceLength: 14,
  pieceLengthVariance: 5,
  bendProbability: 0.35,
  minStraightRun: 2,
};

export const DEFAULT_PLAY_PARAMS: PlayParams = {
  lives: 3,
  animationDurationMs: 420,
};

/**
 * A binary region on the grid, after repair and parity absorption.
 *
 * `inside[i] === 1` means the cell belongs to the silhouette.
 * `unvisited[i] === 1` means the cell is inside the silhouette but is
 * deliberately left off the Hamiltonian path to fix checkerboard parity
 * (PRD §4.2 step 1.6). Such cells are inside but never covered.
 */
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly inside: Uint8Array;
  readonly unvisited: Uint8Array;
  /** Count of cells with inside=1 and unvisited=0. The path must cover exactly these. */
  readonly pathCellCount: number;
}

/**
 * A Hamiltonian path over `{ inside && !unvisited }`, in walk order.
 * Consecutive entries are 4-neighbours. Length === Mask.pathCellCount.
 */
export interface HamiltonianPath {
  readonly cells: Uint32Array;
}

/**
 * The finished board. All flat typed arrays in CSR form (ADR-0003) — no
 * per-segment objects, no per-cell objects, at any board size.
 */
export interface Board {
  readonly width: number;
  readonly height: number;
  readonly params: GenParams;

  /** Number of segments, n. Valid ids are 1..n. */
  readonly segmentCount: number;

  /** cells -> SegmentId, 0 for empty. Length width*height. */
  readonly occupancy: Uint16Array;

  /** CSR offsets into segCells. Length n+1; segment k occupies [segStart[k], segStart[k+1]). */
  readonly segStart: Uint32Array;
  /** Flattened per-segment polylines, ordered tail -> head. */
  readonly segCells: Uint32Array;
  /** Head cell index per segment. Length n. Indexed by (id - 1). */
  readonly segHead: Uint32Array;
  /** Exit direction per segment. Length n. */
  readonly segDir: Uint8Array;

  /** CSR offsets into edgeTarget. Length n+1. */
  readonly edgeStart: Uint32Array;
  /** Flattened blocking edges. An edge k -> j means j must be removed before k. */
  readonly edgeTarget: Uint32Array;

  /** Palette index per segment, 0..(paletteSize-1). Length n. */
  readonly segColor: Uint8Array;
}

/** Numbers the tuning harness reports. See docs/METRICS.md. */
export interface BoardMetrics {
  readonly segmentCount: number;
  /** Covered cells / inside cells. Target >= 0.99 (PRD §3.1). */
  readonly coverage: number;
  readonly meanSegmentLength: number;
  /** Fraction of interior path cells that are corners. Ground truth for R1. */
  readonly bendRate: number;
  /** Longest chain in the blocking DAG. */
  readonly dagDepth: number;
  /** Mean number of clickable segments across a full greedy clear. */
  readonly meanFreeSetSize: number;
  readonly minFreeSetSize: number;
  /** Blocking edges. */
  readonly edgeCount: number;
  readonly generationMs: number;
}

/** Thrown by validation. Fails loudly in dev (PRD §4.2 step 5). */
export class BoardInvariantError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'BoardInvariantError';
  }
}

/** The single public entry point of the generator. */
export type GenerateBoard = (params: GenParams) => Board;
