/**
 * Shared vocabulary for the whole generator pipeline.
 *
 * Layout conventions the rest of the codebase indexes against:
 *   - A cell index is `y * width + x`.
 *   - Segment ids are 1-based. Id 0 in `occupancy` means "empty cell".
 *   - Directions are 0=North(-y) 1=East(+x) 2=South(+y) 3=West(-x).
 */

/** `y * width + x`. */
export type CellIndex = number;

/** 1-based. 0 is reserved for "no segment". */
export type SegmentId = number;

/** 0=N, 1=E, 2=S, 3=W. */
export type Direction = 0 | 1 | 2 | 3;

/** Unsigned 32-bit. */
export type Seed = number;

/** The complete input to the generator. */
export interface GenParams {
  /** Square board edge length. */
  readonly gridSize: number;
  readonly seed: Seed;
  /**
   * Mean of the distribution segment lengths are sampled from, in cells.
   *
   * Not the achieved mean: `minPieceLength` truncates that distribution's left
   * tail, so the two diverge as the floor takes a larger share of it. A sweep
   * should read the achieved figure.
   */
  readonly meanPieceLength: number;
  /** Spread of that distribution, in cells (std-dev-like). */
  readonly pieceLengthVariance: number;
  /**
   * Floor on segment length in cells. At 1 a segment may be a lone arrowhead
   * with no body; at 2 or more every segment reads as a stroke.
   *
   * A target the generator maintains rather than a guarantee, and it gives up
   * more of it as the floor rises: read `PeelStats.belowMinimum` for what a
   * given board actually cost.
   */
  readonly minPieceLength: number;
  /**
   * 0..1 steer on how often the space-filling path turns rather than carries
   * straight on.
   *
   * Not a target rate: the contour method's own geometry bounds what is
   * reachable from both ends, and the mapping is monotonic but not linear, so
   * read the achieved `bendRate` rather than this.
   */
  readonly bendProbability: number;
  /** A cut may not leave a straight run shorter than this. */
  readonly minStraightRun: number;
  /**
   * Fraction of the grid the raw silhouette aims to occupy, before repair
   * trims it. A tuning dial, not an area guarantee: the boundary is perturbed
   * into an organic shape, so achieved area tracks this only loosely.
   */
  readonly fillFraction: number;
  /**
   * How many lobes the raw silhouette is drawn from. At 1 it is one compact
   * mass; above that the lobes are placed apart and become separate regions,
   * each with its own path.
   *
   * A request, not a count: `fillFraction` is split between them, so a high
   * lobe count on a small grid gives each lobe too little to survive the
   * morphological open and generation declines. Read `Mask.regionCount` for
   * what a board actually got.
   */
  readonly lobeCount: number;
}

/** Gameplay knobs that do not affect board generation. */
export interface PlayParams {
  readonly lives: number;
  readonly animationDurationMs: number;
}

export const DEFAULT_GEN_PARAMS: GenParams = {
  gridSize: 40,
  seed: 1,
  meanPieceLength: 6,
  pieceLengthVariance: 8,
  minPieceLength: 2,
  bendProbability: 0.6,
  minStraightRun: 2,
  fillFraction: 0.45,
  lobeCount: 1,
};

export const DEFAULT_PLAY_PARAMS: PlayParams = {
  lives: 3,
  animationDurationMs: 420,
};

/**
 * A silhouette on the grid, after repair and parity absorption. It may be
 * several disjoint lobes: a silhouette is not one connected mass, and each
 * lobe carries its own Hamiltonian path.
 *
 * `inside[i] === 1` means the cell belongs to the silhouette.
 * `unvisited[i] === 1` means the cell is inside the silhouette but is
 * deliberately left off the Hamiltonian path to fix checkerboard parity, so it
 * is inside and never covered.
 */
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly inside: Uint8Array;
  readonly unvisited: Uint8Array;
  /** Count of cells with inside=1 and unvisited=0. The path must cover exactly these. */
  readonly pathCellCount: number;
  /**
   * 1-based region id per cell; 0 where the cell carries no path — outside the
   * silhouette, or inside it and unvisited. Each region is separately
   * 4-connected.
   */
  readonly regionOf: Uint16Array;
  /** Number of regions. Valid ids are 1..regionCount. */
  readonly regionCount: number;
}

/**
 * One Hamiltonian path per region of a `Mask`, concatenated in region-id
 * order. Total length === Mask.pathCellCount.
 *
 * `regionStart` is CSR over `cells`: region id `r` walks
 * `cells[regionStart[r - 1] .. regionStart[r])`. Consecutive entries within a
 * region are 4-neighbours; the pair straddling a region boundary is not, so
 * anything walking the path has to stop at `regionStart`.
 */
export interface HamiltonianPath {
  readonly cells: Uint32Array;
  /** Length regionCount + 1, starting at 0 and ending at cells.length. */
  readonly regionStart: Uint32Array;
}

/** The finished board: flat typed arrays in CSR form, no per-cell objects. */
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
  /**
   * Head cell index per segment. Length n. Indexed by (id - 1).
   *
   * Always the *last* cell of the segment's segCells slice, so a segment whose
   * head is the other endpoint is emitted with its cells reversed.
   * `checkStructure` enforces this.
   */
  readonly segHead: Uint32Array;
  /**
   * Exit direction per segment. Length n.
   *
   * For a segment of two cells or more this is the direction of its terminal
   * stroke rather than an independent choice: picking the head fixes it. A
   * one-cell segment has no terminal stroke, so all four are legal for it.
   */
  readonly segDir: Uint8Array;

  /** CSR offsets into edgeTarget. Length n+1. */
  readonly edgeStart: Uint32Array;
  /** Flattened blocking edges. An edge k -> j means j must be removed before k. */
  readonly edgeTarget: Uint32Array;

  /** Palette index per segment, 0..(paletteSize-1). Length n. */
  readonly segColor: Uint8Array;
}

/** Numbers the tuning harness reports. */
export interface BoardMetrics {
  readonly segmentCount: number;
  /** Covered cells / inside cells. */
  readonly coverage: number;
  readonly meanSegmentLength: number;
  /** Fraction of interior path cells that are corners. */
  readonly bendRate: number;
  /** Longest chain in the blocking DAG. */
  readonly dagDepth: number;
  /** Mean number of clickable segments across a full greedy clear. */
  readonly meanFreeSetSize: number;
  /**
   * Smallest free set at a step where something was still blocked. Steps where
   * every remaining segment is free — always including the last — are endgame,
   * not bottleneck, and counting them makes this 1 on every board.
   */
  readonly minFreeSetSize: number;
  /** Blocking edges. */
  readonly edgeCount: number;
  readonly generationMs: number;
}

/** Thrown by validation. */
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
