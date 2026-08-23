/**
 * Cuts the path into segments and picks each one's head in a single pass, so
 * that the blocking digraph comes out acyclic by construction.
 *
 * The peel keeps a set of not-yet-committed path cells and repeatedly commits
 * one piece: a contiguous run of still-free path positions, with a head at one
 * of its two ends, accepted only when the ray from that head to the board edge
 * crosses no cell that is still free. Committing removes those cells.
 *
 * Every blocker on a committed piece's ray is therefore a piece committed
 * earlier, so commit order is a valid removal order and the digraph has no
 * cycle to search for.
 *
 * The peel cannot stall. Let `c` be the topmost free cell anywhere on the
 * board. Its column holds no free cell above it, so the whole northward ray
 * from `c` is free of live cells, and a one-cell piece at `c` has all four
 * directions legal, north among them. So a legal move exists whenever any
 * cell remains, and `chooseCandidate` enumerates that move: `c` is the
 * north-exposed cell of its column.
 *
 * What can degrade is piece quality, not feasibility: when the free set
 * fragments, the lengths on offer shrink. `PeelStats` reports how often that
 * happened, so a sweep can see the trade rather than infer it.
 */

import { directionBetween, opposite, xOf, yOf } from '../grid.js';
import type { Rng } from '../rng.js';
import type { Direction, GenParams, HamiltonianPath } from '../types.js';

export interface PeeledSegments {
  /** CSR offsets into `segCells`. Length n+1; segment k occupies [segStart[k], segStart[k+1]). */
  readonly segStart: Uint32Array;
  /** Flattened per-segment polylines, already ordered tail -> head. */
  readonly segCells: Uint32Array;
  /** Head cell per segment, always the last cell of its slice. Length n. */
  readonly segHead: Uint32Array;
  /** Exit direction per segment. Length n. */
  readonly segDir: Uint8Array;
  /**
   * 1 where a segment's slice runs against path order, because its head is
   * the endpoint the path reaches first. `segCells` already has this applied;
   * un-applying it recovers `path.cells`.
   */
  readonly segReversed: Uint8Array;
  /**
   * Segment ids in the order the peel committed them. Every blocker appears
   * before the segments it blocks, so this is a valid removal order.
   */
  readonly peelOrder: Uint32Array;
  readonly stats: PeelStats;
}

/** What the peel had to give up to stay feasible. */
export interface PeelStats {
  readonly segmentCount: number;
  readonly meanLength: number;
  readonly lengthStdDev: number;
  /** Pieces committed shorter than the length sampled for them. */
  readonly shortOfTarget: number;
  /** Pieces that had to come down to a single cell despite a longer target. */
  readonly forcedSingles: number;
  /** Cuts that left a straight run shorter than `minStraightRun`. */
  readonly shortStraightRuns: number;
}

/** Which way along the path a piece extends from its head. */
const BACKWARD = 0;
const FORWARD = 1;
type Mode = typeof BACKWARD | typeof FORWARD;

const LENGTH_COST = 3;
const FRAGMENT_COST = 4;
const STRANDED_COST = 14;
const STRAIGHT_RUN_COST = 6;
const JITTER = 2;

export function peelSegments(
  path: HamiltonianPath,
  params: GenParams,
  rng: Rng,
  width: number,
  height: number,
): PeeledSegments {
  const cells = path.cells;
  const length = cells.length;

  if (length === 0) {
    return {
      segStart: Uint32Array.from([0]),
      segCells: new Uint32Array(0),
      segHead: new Uint32Array(0),
      segDir: new Uint8Array(0),
      segReversed: new Uint8Array(0),
      peelOrder: new Uint32Array(0),
      stats: {
        segmentCount: 0,
        meanLength: 0,
        lengthStdDev: 0,
        shortOfTarget: 0,
        forcedSingles: 0,
        shortStraightRuns: 0,
      },
    };
  }

  const stepDir = new Uint8Array(length - 1);
  for (let e = 0; e < length - 1; e++) {
    const from = cells[e] as number;
    const to = cells[e + 1] as number;
    const dir = directionBetween(from, to, width);
    if (dir === -1) {
      throw new Error(
        `peelSegments: path cells ${from} and ${to} (step ${e}) are not 4-neighbours; ` +
          'peelSegments requires a valid HamiltonianPath',
      );
    }
    stepDir[e] = dir;
  }

  const straight = straightRuns(stepDir);
  // Below 1 the constraint is vacuous: every cut satisfies it.
  const minStraightRun = Math.max(1, Math.round(params.minStraightRun));
  const targetLength = Math.max(1, params.meanPieceLength);
  const spread = Math.max(0, params.pieceLengthVariance);
  // A remnant shorter than this is absorbed rather than left to become a
  // stub piece later.
  const minKeep = Math.max(2, Math.round(targetLength / 2));

  const board = new BoardState(cells, width, height);
  const committed = new Uint8Array(length);

  const pieceStart: number[] = [];
  const pieceEnd: number[] = [];
  const pieceHeadPos: number[] = [];
  const pieceDir: number[] = [];

  let shortOfTarget = 0;
  let forcedSingles = 0;
  let shortStraightRuns = 0;

  const candidate: Candidate = { headPos: -1, dir: 0, mode: BACKWARD, pieceLength: 1 };
  const scratch: Candidate = { headPos: -1, dir: 0, mode: BACKWARD, pieceLength: 1 };

  let remaining = length;
  while (remaining > 0) {
    const sampled = Math.round(rng.normal(targetLength, spread));
    const target = Math.min(Math.max(sampled, 1), length);

    const found = chooseCandidate(candidate, scratch, target);
    if (!found) {
      // Unreachable while cells remain — see the module comment. Kept as a
      // throw rather than a silent stall so a broken exposure index cannot
      // present itself as an empty board.
      throw new Error(
        `peelSegments: no legal piece with ${remaining} of ${length} path cells still free`,
      );
    }

    const head = candidate.headPos;
    const pieceLen = candidate.pieceLength;
    const from = candidate.mode === BACKWARD ? head - pieceLen + 1 : head;
    const to = candidate.mode === BACKWARD ? head : head + pieceLen - 1;

    if (pieceLen < target) {
      shortOfTarget++;
      if (pieceLen === 1) forcedSingles++;
    }
    if (from > 0 && committed[from - 1] === 0 && cutViolates(from - 1)) shortStraightRuns++;
    if (to < length - 1 && committed[to + 1] === 0 && cutViolates(to)) shortStraightRuns++;

    for (let i = from; i <= to; i++) {
      committed[i] = 1;
      board.remove(cells[i] as number);
    }
    remaining -= pieceLen;

    pieceStart.push(from);
    pieceEnd.push(to);
    pieceHeadPos.push(head);
    pieceDir.push(candidate.dir);
  }

  return assemble();

  /**
   * Fills `best` with the lowest-cost legal piece whose head is an exposed
   * cell, and answers whether one was found.
   *
   * Exposure is what makes the acceptance test free: a cell that is the
   * first free cell of its column or row in some direction has, by
   * definition, nothing free along the ray that way.
   */
  function chooseCandidate(best: Candidate, probe: Candidate, target: number): boolean {
    let bestCost = Infinity;
    let found = false;

    const consider = (cell: number, dir: Direction): void => {
      const cost = evaluate(probe, cell, dir, target) + rng.next() * JITTER;
      if (cost >= bestCost) return;
      bestCost = cost;
      found = true;
      best.headPos = probe.headPos;
      best.dir = probe.dir;
      best.mode = probe.mode;
      best.pieceLength = probe.pieceLength;
    };

    for (let x = 0; x < width; x++) {
      if (board.colAlive[x] === 0) continue;
      consider(board.topOf(x) * width + x, 0);
      consider(board.bottomOf(x) * width + x, 2);
    }
    for (let y = 0; y < height; y++) {
      if (board.rowAlive[y] === 0) continue;
      consider(y * width + board.rightOf(y), 1);
      consider(y * width + board.leftOf(y), 3);
    }

    return found;
  }

  /**
   * Fills `out` with the cheapest piece that exits `cell` in `dir`, and
   * answers what it costs.
   *
   * A piece of two cells or more takes its exit direction from its terminal
   * stroke, so `dir` decides which way along the path such a piece may
   * extend — often neither. The one-cell piece is what is always on offer:
   * with no terminal stroke to read, every direction is legal for it.
   */
  function evaluate(out: Candidate, cell: number, dir: Direction, target: number): number {
    const pos = board.posOf(cell);
    let bestCost = Infinity;
    let bestLen = 1;
    let bestMode: Mode = BACKWARD;

    const propose = (mode: Mode, pieceLen: number): void => {
      const from = mode === BACKWARD ? pos - pieceLen + 1 : pos;
      const cost = scorePiece(from, from + pieceLen - 1, pieceLen, target);
      if (cost >= bestCost) return;
      bestCost = cost;
      bestLen = pieceLen;
      bestMode = mode;
    };

    if (pos >= 1 && committed[pos - 1] === 0 && (stepDir[pos - 1] as number) === dir) {
      propose(BACKWARD, pieceLengthFor(freeRun(pos, -1, target + minKeep), target));
    }
    if (
      pos <= length - 2 &&
      committed[pos + 1] === 0 &&
      opposite(stepDir[pos] as Direction) === dir
    ) {
      propose(FORWARD, pieceLengthFor(freeRun(pos, 1, target + minKeep), target));
    }
    propose(BACKWARD, 1);

    out.headPos = pos;
    out.dir = dir;
    out.mode = bestMode;
    out.pieceLength = bestLen;
    return bestCost;
  }

  /**
   * How long to make a piece with `free` cells available that wants `target`.
   * A remainder too short to become a piece of its own is absorbed rather
   * than left behind to force a stub later.
   */
  function pieceLengthFor(free: number, target: number): number {
    const remainder = free - target;
    if (remainder > 0 && remainder < minKeep) return free;
    return Math.min(target, free);
  }

  /**
   * What committing `[from, to]` costs: how far off `target` it lands, what
   * it leaves stranded on either side, and whether it cuts a straight run too
   * close to that run's end.
   */
  function scorePiece(from: number, to: number, pieceLen: number, target: number): number {
    let cost = LENGTH_COST * Math.abs(pieceLen - target);
    cost += sideCost(from - 1, -1) + sideCost(to + 1, 1);
    if (from > 0 && committed[from - 1] === 0 && cutViolates(from - 1)) cost += STRAIGHT_RUN_COST;
    if (to < length - 1 && committed[to + 1] === 0 && cutViolates(to)) cost += STRAIGHT_RUN_COST;
    return cost;
  }

  /** What the free cells left beyond one end of a piece cost. */
  function sideCost(pos: number, stride: number): number {
    const free = freeRun(pos, stride, minKeep);
    if (free === 0) return 0;
    return free < minKeep ? FRAGMENT_COST + STRANDED_COST : FRAGMENT_COST;
  }

  /** Free positions starting at `pos` and walking by `stride`, capped at `cap`. */
  function freeRun(pos: number, stride: number, cap: number): number {
    let n = 0;
    let p = pos;
    while (n < cap && p >= 0 && p < length && committed[p] === 0) {
      n++;
      p += stride;
    }
    return n;
  }

  /**
   * Whether severing the path between cells `e` and `e + 1` splits a straight
   * run into a piece shorter than `minStraightRun`. A run with no compliant
   * split anywhere is exempt, as the path itself offers nothing better.
   */
  function cutViolates(e: number): boolean {
    if (e < 1 || e >= length - 1) return false;
    if (stepDir[e - 1] !== stepDir[e]) return false;
    const runFrom = straight.start[e] as number;
    const runTo = straight.end[e] as number;
    const validLo = runFrom + minStraightRun - 1;
    const validHi = runTo - minStraightRun + 1;
    if (validLo > validHi) return false;
    return e < validLo || e > validHi;
  }

  function assemble(): PeeledSegments {
    const count = pieceStart.length;
    const order = Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => (pieceStart[a] as number) - (pieceStart[b] as number),
    );

    const segStart = new Uint32Array(count + 1);
    const segCells = new Uint32Array(length);
    const segHead = new Uint32Array(count);
    const segDir = new Uint8Array(count);
    const segReversed = new Uint8Array(count);
    const idOfPiece = new Uint32Array(count);

    let written = 0;
    let lengthSum = 0;
    let squareSum = 0;
    for (let k = 0; k < count; k++) {
      const piece = order[k] as number;
      idOfPiece[piece] = k + 1;
      const from = pieceStart[piece] as number;
      const to = pieceEnd[piece] as number;
      if (from !== written) {
        throw new Error(
          `peelSegments: piece ${k} starts at path position ${from}, expected ${written}`,
        );
      }
      segStart[k] = written;
      const headPos = pieceHeadPos[piece] as number;
      const reversed = headPos === from && to !== from;
      segReversed[k] = reversed ? 1 : 0;
      for (let i = from; i <= to; i++) {
        segCells[written++] = cells[reversed ? to - (i - from) : i] as number;
      }
      segHead[k] = cells[headPos] as number;
      segDir[k] = pieceDir[piece] as number;
      const size = to - from + 1;
      lengthSum += size;
      squareSum += size * size;
    }
    if (written !== length) {
      throw new Error(`peelSegments: pieces cover ${written} of ${length} path cells`);
    }
    segStart[count] = length;

    const peelOrder = new Uint32Array(count);
    for (let i = 0; i < count; i++) peelOrder[i] = idOfPiece[i] as number;

    const mean = count === 0 ? 0 : lengthSum / count;
    const variance = count === 0 ? 0 : Math.max(squareSum / count - mean * mean, 0);

    return {
      segStart,
      segCells,
      segHead,
      segDir,
      segReversed,
      peelOrder,
      stats: {
        segmentCount: count,
        meanLength: mean,
        lengthStdDev: Math.sqrt(variance),
        shortOfTarget,
        forcedSingles,
        shortStraightRuns,
      },
    };
  }
}

interface Candidate {
  headPos: number;
  dir: Direction;
  mode: Mode;
  pieceLength: number;
}

interface StraightRuns {
  /** First edge of the maximal same-direction run containing edge e. */
  readonly start: Int32Array;
  /** Last edge of that run. */
  readonly end: Int32Array;
}

function straightRuns(stepDir: Uint8Array): StraightRuns {
  const edges = stepDir.length;
  const start = new Int32Array(edges);
  const end = new Int32Array(edges);
  for (let e = 0; e < edges; e++) {
    start[e] = e === 0 || stepDir[e] !== stepDir[e - 1] ? e : (start[e - 1] as number);
  }
  for (let e = edges - 1; e >= 0; e--) {
    end[e] = e === edges - 1 || stepDir[e] !== stepDir[e + 1] ? e : (end[e + 1] as number);
  }
  return { start, end };
}

/**
 * The free path cells, indexed so that the extreme free cell of any row or
 * column is O(1) amortised to find.
 *
 * Each of the four scan pointers only ever moves one way — cells are removed
 * and never restored — so the whole peel pays each pointer's travel once.
 */
class BoardState {
  readonly colAlive: Int32Array;
  readonly rowAlive: Int32Array;
  private readonly alive: Uint8Array;
  private readonly position: Int32Array;
  private readonly colTop: Int32Array;
  private readonly colBottom: Int32Array;
  private readonly rowLeft: Int32Array;
  private readonly rowRight: Int32Array;

  constructor(
    cells: Uint32Array,
    private readonly width: number,
    private readonly height: number,
  ) {
    const size = width * height;
    this.alive = new Uint8Array(size);
    this.position = new Int32Array(size).fill(-1);
    this.colAlive = new Int32Array(width);
    this.rowAlive = new Int32Array(height);
    this.colTop = new Int32Array(width);
    this.colBottom = new Int32Array(width).fill(height - 1);
    this.rowLeft = new Int32Array(height);
    this.rowRight = new Int32Array(height).fill(width - 1);

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as number;
      const x = xOf(cell, width);
      const y = yOf(cell, width);
      this.alive[cell] = 1;
      this.position[cell] = i;
      this.colAlive[x] = (this.colAlive[x] as number) + 1;
      this.rowAlive[y] = (this.rowAlive[y] as number) + 1;
    }
  }

  posOf(cell: number): number {
    return this.position[cell] as number;
  }

  remove(cell: number): void {
    const x = xOf(cell, this.width);
    const y = yOf(cell, this.width);
    this.alive[cell] = 0;
    this.colAlive[x] = (this.colAlive[x] as number) - 1;
    this.rowAlive[y] = (this.rowAlive[y] as number) - 1;
  }

  topOf(x: number): number {
    let y = this.colTop[x] as number;
    while (y < this.height && this.alive[y * this.width + x] === 0) y++;
    this.colTop[x] = y;
    return y;
  }

  bottomOf(x: number): number {
    let y = this.colBottom[x] as number;
    while (y >= 0 && this.alive[y * this.width + x] === 0) y--;
    this.colBottom[x] = y;
    return y;
  }

  leftOf(y: number): number {
    let x = this.rowLeft[y] as number;
    while (x < this.width && this.alive[y * this.width + x] === 0) x++;
    this.rowLeft[y] = x;
    return x;
  }

  rightOf(y: number): number {
    let x = this.rowRight[y] as number;
    while (x >= 0 && this.alive[y * this.width + x] === 0) x--;
    this.rowRight[y] = x;
    return x;
  }
}
