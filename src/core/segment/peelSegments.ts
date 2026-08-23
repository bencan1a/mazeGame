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
 * The peel cannot stall. Take the topmost free cell and, among that row, the
 * leftmost — call it `c`. Nothing free lies above `c` in its column and
 * nothing free lies west of it in its row, so both those rays are clear. Every
 * free path-neighbour of `c` is therefore east of it or below it, and a piece
 * ending at `c` arrives from one of them: travelling west from the east
 * neighbour, or north from the south one. `segDir` is that arrival direction,
 * so the piece exits west or north — clear either way. `chooseCandidate`
 * enumerates `c` twice, as the north-exposed cell of its column and the
 * west-exposed cell of its row.
 *
 * `minPieceLength` is a target the peel maintains, not a second guarantee.
 * Writing `c`'s run as `[lo, hi]` and its position as `p`, the two moves that
 * leave no remnant behind are `[lo, p]` and `[p, hi]`, so both fall short of
 * the floor only when the run holds fewer than `2 * minPieceLength - 1` cells
 * with `p` away from both ends. At the default floor of 2 that is a three-cell
 * run with `c` in the middle, plus the one-cell run where neither move exists;
 * at larger floors it is a widening family of runs. `wholeRunEscape` covers
 * what it can by committing a whole run against an exactly-checked ray, and
 * where even that fails the peel relaxes rather than failing.
 * `PeelStats.belowMinimum` counts every piece that cost, and is what a caller
 * should read rather than assuming the floor held.
 *
 * What can degrade is piece quality, not feasibility: when the free set
 * fragments, the lengths on offer shrink. `PeelStats` reports how often that
 * happened, so a sweep can see the trade rather than infer it.
 */

import { NO_CELL, directionBetween, opposite, step, xOf, yOf } from '../grid.js';
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
  /** Pieces that came out shorter than `minPieceLength`. Nothing else reports this. */
  readonly belowMinimum: number;
  /** Steps that had to take a whole run to keep every piece legal. */
  readonly wholeRunEscapes: number;
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
        belowMinimum: 0,
        wholeRunEscapes: 0,
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
  // Below 1 each constraint is vacuous: every cut satisfies it.
  const minStraightRun = Math.max(1, Math.round(params.minStraightRun));
  const minLength = Math.max(1, Math.round(params.minPieceLength));
  const targetLength = Math.max(minLength, params.meanPieceLength);
  const spread = Math.max(0, params.pieceLengthVariance);
  // A remnant shorter than this is absorbed rather than left behind, even
  // though it would be a legal piece on its own.
  const absorbBelow = Math.max(minLength, Math.round(targetLength / 2));

  const board = new BoardState(cells, width, height);
  const committed = new Uint8Array(length);

  const pieceStart: number[] = [];
  const pieceEnd: number[] = [];
  const pieceHeadPos: number[] = [];
  const pieceDir: number[] = [];

  let shortOfTarget = 0;
  let belowMinimum = 0;
  let wholeRunEscapes = 0;
  let shortStraightRuns = 0;

  const candidate: Candidate = { headPos: -1, dir: 0, mode: BACKWARD, pieceLength: 1 };
  const scratch: Candidate = { headPos: -1, dir: 0, mode: BACKWARD, pieceLength: 1 };

  let remaining = length;
  while (remaining > 0) {
    const sampled = Math.round(rng.normal(targetLength, spread));
    const target = Math.min(Math.max(sampled, minLength), length);

    if (!chooseCandidate(candidate, scratch, target, false)) {
      if (wholeRunEscape(candidate)) {
        wholeRunEscapes++;
      } else if (!chooseCandidate(candidate, scratch, target, true)) {
        // Unreachable while cells remain — see the module comment. Kept as a
        // throw rather than a silent stall so a broken exposure index cannot
        // present itself as an empty board.
        throw new Error(
          `peelSegments: no legal piece with ${remaining} of ${length} path cells still free`,
        );
      }
    }

    const head = candidate.headPos;
    const pieceLen = candidate.pieceLength;
    const from = candidate.mode === BACKWARD ? head - pieceLen + 1 : head;
    const to = candidate.mode === BACKWARD ? head : head + pieceLen - 1;

    if (pieceLen < target) shortOfTarget++;
    if (pieceLen < minLength) belowMinimum++;
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
   * Exposure is what makes the acceptance test free: a cell that is the first
   * free cell of its column or row in some direction has, by definition,
   * nothing free along the ray that way.
   *
   * `relaxed` drops the length floor and the remnant rule — quality rules, not
   * correctness ones — for the rare step where nothing else is on offer.
   */
  function chooseCandidate(
    best: Candidate,
    probe: Candidate,
    target: number,
    relaxed: boolean,
  ): boolean {
    let bestCost = Infinity;
    let found = false;

    const consider = (cell: number, dir: Direction): void => {
      const cost = evaluate(probe, cell, dir, target, relaxed) + rng.next() * JITTER;
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
   * answers what it costs. `Infinity` means no legal piece exits that way.
   *
   * A piece takes its exit direction from its terminal stroke, so `dir`
   * decides which way along the path it may extend — often neither.
   */
  function evaluate(
    out: Candidate,
    cell: number,
    dir: Direction,
    target: number,
    relaxed: boolean,
  ): number {
    const pos = board.posOf(cell);
    const floor = relaxed ? 1 : minLength;
    let bestCost = Infinity;
    let bestLen = 0;
    let bestMode: Mode = BACKWARD;

    const propose = (mode: Mode, pieceLen: number): void => {
      if (pieceLen < floor) return;
      const from = mode === BACKWARD ? pos - pieceLen + 1 : pos;
      const to = from + pieceLen - 1;
      const before = freeRun(from - 1, -1, absorbBelow);
      const after = freeRun(to + 1, 1, absorbBelow);
      // A remnant below the floor could only ever become an illegal piece.
      if (!relaxed && ((before > 0 && before < floor) || (after > 0 && after < floor))) return;
      const cost = scorePiece(from, to, pieceLen, target, before, after);
      if (cost >= bestCost) return;
      bestCost = cost;
      bestLen = pieceLen;
      bestMode = mode;
    };

    const tryMode = (mode: Mode, stride: number): void => {
      // Capped, so `free` is "at least this many" once it reaches the cap —
      // enough to size a piece, and every length offered stays inside it.
      const free = freeRun(pos, stride, target + absorbBelow);
      if (free < floor) return;
      propose(mode, pieceLengthFor(free, target));
      propose(mode, floor);
      propose(mode, free);
    };

    if (pos >= 1 && committed[pos - 1] === 0 && (stepDir[pos - 1] as number) === dir) {
      tryMode(BACKWARD, -1);
    }
    if (
      pos <= length - 2 &&
      committed[pos + 1] === 0 &&
      opposite(stepDir[pos] as Direction) === dir
    ) {
      tryMode(FORWARD, 1);
    }
    if (floor === 1) propose(BACKWARD, 1);

    out.headPos = pos;
    out.dir = dir;
    out.mode = bestMode;
    out.pieceLength = bestLen;
    return bestCost;
  }

  /**
   * Fills `out` with a whole free run whose head ray is clear, if one exists.
   *
   * Taking a run entire is the move that leaves no remnant to be short, which
   * is what the ordinary candidates can run out of. It costs an exact ray walk
   * per endpoint instead of relying on exposure, and an O(path) scan for the
   * runs, so it is only reached when nothing else is on offer.
   */
  function wholeRunEscape(out: Candidate): boolean {
    let lo = 0;
    while (lo < length) {
      if (committed[lo] === 1) {
        lo++;
        continue;
      }
      let hi = lo;
      while (hi + 1 < length && committed[hi + 1] === 0) hi++;

      if (hi - lo + 1 >= minLength) {
        const headAtHi = hi > lo ? (stepDir[hi - 1] as Direction) : null;
        const headAtLo = hi > lo ? opposite(stepDir[lo] as Direction) : null;
        if (headAtHi !== null && rayIsClear(cells[hi] as number, headAtHi, lo, hi)) {
          out.headPos = hi;
          out.dir = headAtHi;
          out.mode = BACKWARD;
          out.pieceLength = hi - lo + 1;
          return true;
        }
        if (headAtLo !== null && rayIsClear(cells[lo] as number, headAtLo, lo, hi)) {
          out.headPos = lo;
          out.dir = headAtLo;
          out.mode = FORWARD;
          out.pieceLength = hi - lo + 1;
          return true;
        }
      }
      lo = hi + 1;
    }
    return false;
  }

  /** Whether the ray from `cell` meets no free cell outside `[from, to]`. */
  function rayIsClear(cell: number, dir: Direction, from: number, to: number): boolean {
    let next = step(cell, dir, width, height);
    while (next !== NO_CELL) {
      const pos = board.posOf(next);
      if (pos >= 0 && committed[pos] === 0 && (pos < from || pos > to)) return false;
      next = step(next, dir, width, height);
    }
    return true;
  }

  /**
   * How long to make a piece with `free` cells available that wants `target`.
   * A remainder too short to become a piece of its own is absorbed rather
   * than left behind to force a stub later.
   */
  function pieceLengthFor(free: number, target: number): number {
    const remainder = free - target;
    if (remainder > 0 && remainder < absorbBelow) return free;
    return Math.min(target, free);
  }

  /**
   * What committing `[from, to]` costs: how far off `target` it lands, what
   * it leaves stranded on either side, and whether it cuts a straight run too
   * close to that run's end.
   */
  function scorePiece(
    from: number,
    to: number,
    pieceLen: number,
    target: number,
    before: number,
    after: number,
  ): number {
    let cost = LENGTH_COST * Math.abs(pieceLen - target);
    cost += sideCost(before) + sideCost(after);
    if (from > 0 && committed[from - 1] === 0 && cutViolates(from - 1)) cost += STRAIGHT_RUN_COST;
    if (to < length - 1 && committed[to + 1] === 0 && cutViolates(to)) cost += STRAIGHT_RUN_COST;
    return cost;
  }

  /** What the free cells left beyond one end of a piece cost. */
  function sideCost(free: number): number {
    if (free === 0) return 0;
    return free < absorbBelow ? FRAGMENT_COST + STRANDED_COST : FRAGMENT_COST;
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
    if (e < 0 || e > length - 2) return false;
    // Cell 0 has no stroke arriving at it, so it is not a corner; every other
    // corner cut splits nothing straight and is free. Reading stepDir[-1] to
    // decide that would answer undefined, which compares unequal and would
    // wave the cut through.
    if (e >= 1 && stepDir[e - 1] !== stepDir[e]) return false;
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
        belowMinimum,
        wholeRunEscapes,
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
