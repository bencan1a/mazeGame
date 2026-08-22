/**
 * Synthetic `Board` fixtures.
 *
 * The spec is a picture: lowercase letters are segment bodies, the uppercase
 * letter is that segment's head, `.` is outside, `o` is inside but unvisited.
 *
 *     aaaa
 *     bbBA
 *     bbcc
 *     Cccc
 *
 * Everything else is derived from the picture, because everything else is
 * forced by it. A segment is a simple path, so naming the head fixes the
 * tail -> head order of segCells; the contract defines segDir as the terminal
 * stroke, so the last two cells fix the exit direction; and the blocking edges
 * are whatever the exit ray hits. A spec that had to restate any of those
 * would be a spec that could contradict its own picture.
 */

import { DIRECTIONS, NO_CELL, directionBetween, opposite, step } from '../../src/core/grid.js';
import type { Board, Direction, GenParams, Mask } from '../../src/core/types.js';
import { DEFAULT_GEN_PARAMS } from '../../src/core/types.js';
import { toRows } from './art.js';
import { INSIDE_CHAR, OUTSIDE_CHAR, UNVISITED_CHAR, makeMask } from './mask.js';
import { rayBlockers } from './postconditions.js';

/** Number of hues the greedy colouring may use (PRD: 4-6). */
export const PALETTE_SIZE = 6;

const DIRECTION_OF: Readonly<Record<string, Direction>> = { N: 0, E: 1, S: 2, W: 3 };

export interface BoardSpec {
  /** The picture. */
  readonly art: string;
  /**
   * Exit direction for segments the picture cannot disambiguate, keyed by the
   * lowercase letter. Only single-cell segments need one: they have no terminal
   * stroke to read a direction off.
   */
  readonly dirs?: Readonly<Record<string, 'N' | 'E' | 'S' | 'W'>>;
  /**
   * The walk of a segment whose shape the picture cannot disambiguate, as the
   * directions taken from its tail to its head, keyed by the lowercase letter.
   *
   * Needed when a segment has a *chord* — two of its cells adjacent in the grid
   * but not consecutive in the walk. Any segment cut from a space-filling path
   * that doubles back on itself has them, so this is the ordinary case for a
   * realistic fixture, not an exotic one. Without the walk the cell set admits
   * more than one ordering, and the renderer draws whichever one it is given.
   */
  readonly walks?: Readonly<Record<string, string>>;
  /**
   * Replace the derived blocking edges with `[from, to]` pairs of 1-based ids.
   * For building boards whose CSR deliberately disagrees with their geometry —
   * validateBoard needs failing cases too. Leave it out for real boards.
   */
  readonly edges?: readonly (readonly [number, number])[];
  readonly params?: Partial<GenParams>;
}

export type BoardSpecLike = string | BoardSpec;

function toSpec(spec: BoardSpecLike): BoardSpec {
  return typeof spec === 'string' ? { art: spec } : spec;
}

/** Build a hand-checkable Board from a picture. */
export function makeBoard(spec: BoardSpecLike): Board {
  return makeBoardAndMask(spec).board;
}

/**
 * Build a Board together with the Mask it covers.
 *
 * `validateBoard(board, mask)` takes both, so they have to come from one source
 * or a test ends up asserting against a disagreement it introduced itself.
 */
export function makeBoardAndMask(spec: BoardSpecLike): { board: Board; mask: Mask } {
  const { art, dirs, walks, edges, params } = toSpec(spec);
  const rows = toRows(art);
  const height = rows.length;
  const width = (rows[0] as string).length;
  const size = width * height;

  // Ids are assigned by first appearance in a row-major scan, so a picture
  // always produces the same numbering.
  const idOf = new Map<string, number>();
  const cellsOf: number[][] = [];
  const headOf: number[] = [];

  for (let y = 0; y < height; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < width; x++) {
      const char = row[x] as string;
      const i = y * width + x;
      if (char === OUTSIDE_CHAR || char === UNVISITED_CHAR) continue;
      if (!/^[A-Za-z]$/.test(char)) {
        throw new Error(
          `board art has an unknown character ${JSON.stringify(char)} at (${x}, ${y}); ` +
            `expected a letter, "${OUTSIDE_CHAR}" or "${UNVISITED_CHAR}"`,
        );
      }
      const key = char.toLowerCase();
      if (key === UNVISITED_CHAR) {
        throw new Error(
          `board art cannot use "${char}" as a segment: "${UNVISITED_CHAR}" marks unvisited cells`,
        );
      }
      let id = idOf.get(key);
      if (id === undefined) {
        id = idOf.size + 1;
        idOf.set(key, id);
        cellsOf.push([]);
        headOf.push(NO_CELL);
      }
      (cellsOf[id - 1] as number[]).push(i);
      if (char === char.toUpperCase()) {
        if ((headOf[id - 1] as number) !== NO_CELL) {
          throw new Error(`segment "${key}" has two heads: cells ${headOf[id - 1]} and ${i}`);
        }
        headOf[id - 1] = i;
      }
    }
  }

  const segmentCount = idOf.size;
  if (segmentCount === 0) throw new Error('board art has no segments');

  const occupancy = new Uint16Array(size);
  const segStart = new Uint32Array(segmentCount + 1);
  const segHead = new Uint32Array(segmentCount);
  const segDir = new Uint8Array(segmentCount);
  const ordered: number[][] = [];

  for (const [key, id] of idOf) {
    const cells = cellsOf[id - 1] as number[];
    const head = headOf[id - 1] as number;
    if (head === NO_CELL) {
      throw new Error(
        `segment "${key}" has no head: mark one of its cells uppercase ("${key.toUpperCase()}")`,
      );
    }
    const walk = orderTailToHead(key, cells, head, width, height, walks?.[key]);
    ordered[id - 1] = walk;
    for (const cell of walk) occupancy[cell] = id;
    segHead[id - 1] = head;
    segDir[id - 1] = exitDirection(key, walk, width, dirs);
  }

  const segCells = new Uint32Array(cellsOf.reduce((total, cells) => total + cells.length, 0));
  let at = 0;
  for (let id = 1; id <= segmentCount; id++) {
    segStart[id - 1] = at;
    for (const cell of ordered[id - 1] as number[]) segCells[at++] = cell;
  }
  segStart[segmentCount] = at;

  const skeleton: Board = {
    width,
    height,
    params: { ...DEFAULT_GEN_PARAMS, gridSize: Math.max(width, height), ...params },
    segmentCount,
    occupancy,
    segStart,
    segCells,
    segHead,
    segDir,
    edgeStart: new Uint32Array(segmentCount + 1),
    edgeTarget: new Uint32Array(0),
    segColor: new Uint8Array(segmentCount),
  };

  const blocking = edges === undefined ? deriveEdges(skeleton) : groupEdges(edges, segmentCount);
  const board: Board = {
    ...skeleton,
    edgeStart: blocking.edgeStart,
    edgeTarget: blocking.edgeTarget,
    segColor: greedyColors(skeleton),
  };

  const maskArt = rows
    .map((row) =>
      Array.from(row, (char) =>
        char === OUTSIDE_CHAR || char === UNVISITED_CHAR ? char : INSIDE_CHAR,
      ).join(''),
    )
    .join('\n');
  return { board, mask: makeMask(maskArt) };
}

/**
 * Walk the segment from its tail to its head.
 *
 * The cell set plus the head determines the walk only when the segment has no
 * chord. When it has one the walk is genuinely ambiguous, so this asks for
 * `walks` rather than picking one and letting the renderer draw the other.
 */
function orderTailToHead(
  key: string,
  cells: readonly number[],
  head: number,
  width: number,
  height: number,
  hint: string | undefined,
): number[] {
  const members = new Set(cells);
  if (hint !== undefined) return walkFromHint(key, members, head, width, height, hint);

  const walk: number[] = [];
  let prev = NO_CELL;
  let cell = head;
  for (;;) {
    walk.push(cell);
    let next = NO_CELL;
    for (const dir of DIRECTIONS) {
      const candidate = step(cell, dir, width, height);
      if (candidate === NO_CELL || candidate === prev || !members.has(candidate)) continue;
      if (next !== NO_CELL) {
        throw new Error(
          `segment "${key}" is ambiguous at cell ${cell}: more than one way on. The head has ` +
            `to be an endpoint, and a segment with a chord needs its walk spelled out — ` +
            `pass walks: { ${key}: '...' } as its ${members.size - 1} tail-to-head steps in N/E/S/W.`,
        );
      }
      next = candidate;
    }
    if (next === NO_CELL) break;
    prev = cell;
    cell = next;
  }
  if (walk.length !== members.size) {
    throw new Error(
      `segment "${key}" is not a simple path from its head: walked ${walk.length} of ` +
        `${members.size} cells (is the head marked on an endpoint?)`,
    );
  }
  return walk.reverse();
}

/** Rebuild the walk by stepping backwards from the head along the given directions. */
function walkFromHint(
  key: string,
  members: ReadonlySet<number>,
  head: number,
  width: number,
  height: number,
  hint: string,
): number[] {
  if (hint.length !== members.size - 1) {
    throw new Error(
      `walks.${key} has ${hint.length} step(s) for a ${members.size}-cell segment; ` +
        `expected ${members.size - 1}`,
    );
  }
  const walk = [head];
  let cell = head;
  for (let i = hint.length - 1; i >= 0; i--) {
    const char = hint[i] as string;
    const dir = DIRECTION_OF[char];
    if (dir === undefined) {
      throw new Error(`walks.${key} has an unknown direction ${JSON.stringify(char)}; use N/E/S/W`);
    }
    cell = step(cell, opposite(dir), width, height);
    if (cell === NO_CELL || !members.has(cell)) {
      throw new Error(`walks.${key} step ${i} leaves the segment`);
    }
    if (walk.includes(cell)) throw new Error(`walks.${key} revisits cell ${cell}`);
    walk.push(cell);
  }
  if (walk.length !== members.size) {
    throw new Error(`walks.${key} covers ${walk.length} of ${members.size} cells`);
  }
  return walk.reverse();
}

function exitDirection(
  key: string,
  walk: readonly number[],
  width: number,
  dirs: BoardSpec['dirs'],
): Direction {
  const head = walk[walk.length - 1] as number;
  const given = dirs?.[key];
  if (walk.length === 1) {
    if (given === undefined) {
      throw new Error(
        `segment "${key}" is a single cell and has no terminal stroke; ` +
          `give it a direction, e.g. dirs: { ${key}: 'N' }`,
      );
    }
    return DIRECTION_OF[given] as Direction;
  }
  const stroke = directionBetween(walk[walk.length - 2] as number, head, width) as Direction;
  if (given !== undefined && DIRECTION_OF[given] !== stroke) {
    throw new Error(
      `segment "${key}" exits along its terminal stroke, which the picture says is ` +
        `${'NESW'[stroke] as string}, not ${given}. Move the head instead.`,
    );
  }
  return stroke;
}

function deriveEdges(board: Board): { edgeStart: Uint32Array; edgeTarget: Uint32Array } {
  const perSegment: number[][] = [];
  for (let id = 1; id <= board.segmentCount; id++) perSegment.push(rayBlockers(board, id));
  return toCsr(perSegment, board.segmentCount);
}

function groupEdges(
  edges: readonly (readonly [number, number])[],
  segmentCount: number,
): { edgeStart: Uint32Array; edgeTarget: Uint32Array } {
  const perSegment: number[][] = Array.from({ length: segmentCount }, () => []);
  for (const [from, to] of edges) {
    if (from < 1 || from > segmentCount) throw new Error(`edge source ${from} is not a segment id`);
    if (to < 1 || to > segmentCount) throw new Error(`edge target ${to} is not a segment id`);
    (perSegment[from - 1] as number[]).push(to);
  }
  return toCsr(perSegment, segmentCount);
}

function toCsr(
  perSegment: readonly number[][],
  segmentCount: number,
): { edgeStart: Uint32Array; edgeTarget: Uint32Array } {
  const edgeStart = new Uint32Array(segmentCount + 1);
  const total = perSegment.reduce((sum, targets) => sum + targets.length, 0);
  const edgeTarget = new Uint32Array(total);
  let at = 0;
  for (let id = 1; id <= segmentCount; id++) {
    edgeStart[id - 1] = at;
    for (const target of perSegment[id - 1] as number[]) edgeTarget[at++] = target;
  }
  edgeStart[segmentCount] = at;
  return { edgeStart, edgeTarget };
}

/** Greedy over the 4-adjacency graph. Adjacent segments must not share a hue. */
function greedyColors(board: Board): Uint8Array {
  const neighbours: Set<number>[] = Array.from({ length: board.segmentCount + 1 }, () => new Set());
  for (let i = 0; i < board.occupancy.length; i++) {
    const id = board.occupancy[i] as number;
    if (id === 0) continue;
    for (const dir of DIRECTIONS) {
      const next = step(i, dir, board.width, board.height);
      if (next === NO_CELL) continue;
      const other = board.occupancy[next] as number;
      if (other === 0 || other === id) continue;
      (neighbours[id] as Set<number>).add(other);
    }
  }

  const colors = new Uint8Array(board.segmentCount);
  const assigned = new Set<number>();
  for (let id = 1; id <= board.segmentCount; id++) {
    const taken = new Set<number>();
    for (const other of neighbours[id] as Set<number>) {
      if (assigned.has(other)) taken.add(colors[other - 1] as number);
    }
    let color = 0;
    while (taken.has(color)) color++;
    if (color >= PALETTE_SIZE) {
      throw new Error(`segment ${id} needs hue ${color}, palette holds ${PALETTE_SIZE}`);
    }
    colors[id - 1] = color;
    assigned.add(id);
  }
  return colors;
}

/**
 * Three segments, one 4x4 rectangle, every cell covered.
 *
 *   a runs along the top and turns down the right edge; its head at (3,1) exits
 *   south into c.  b turns up out of the middle and exits east into a.  c wraps
 *   the bottom and exits west off the board, so it is the only free segment.
 *
 * The clear order is therefore forced: c, then a, then b.
 */
export const ACYCLIC_BOARD_ART = ['aaaa', 'bbBA', 'bbcc', 'Cccc'].join('\n');

/** The tail -> head walks of ACYCLIC_BOARD's chorded segments. */
export const ACYCLIC_BOARD_WALKS = { b: 'WNEE', c: 'ESWWW' } as const;

/** Two segments aimed at each other across a gap. The smallest possible cycle. */
export const TWO_CYCLE_BOARD_ART = ['aA.Bb', 'Ccccc'].join('\n');

/**
 * a -> b -> c -> a. c bends up the left edge so that its ray reaches row 0,
 * which is what closes the loop; the gap at (0,1) is on the ray, not a blocker.
 */
export const THREE_CYCLE_BOARD_ART = ['aaAb', '...b', 'C..B', 'cccc'].join('\n');

/** A solvable board: the blocking digraph is a DAG and a greedy clear removes all 3. */
export const ACYCLIC_BOARD: Board = makeBoard({
  art: ACYCLIC_BOARD_ART,
  // b and c are cut from a serpentine, so both double back beside themselves
  // and the picture alone cannot say which way round their walks run.
  walks: ACYCLIC_BOARD_WALKS,
});

/** Unsolvable: segments 1 and 2 block each other. Segment 3 is free and stays that way. */
export const TWO_CYCLE_BOARD: Board = makeBoard(TWO_CYCLE_BOARD_ART);

/** Unsolvable: 1 -> 2 -> 3 -> 1. No segment is ever free. */
export const THREE_CYCLE_BOARD: Board = makeBoard(THREE_CYCLE_BOARD_ART);
