/**
 * Checkerboard parity absorption (PRD §4.2 step 1.6, issue #4).
 *
 * A Hamiltonian path alternates checkerboard colour every step, so a path of
 * `n` cells can only exist when the two colour counts among those cells
 * differ by at most 1 (`parityOf` in `../grid.js` gives the colour). When the
 * raw region breaks that, the fix is to mark the minimum number of cells
 * `unvisited` rather than edit the silhouette — invisible to the player, and
 * it makes the region satisfy the precondition unconditionally.
 *
 * On this generator this function is expected to do nothing: `generateBlob`
 * (#58) draws at half resolution and `repairMask` (#3) repairs at that same
 * half resolution before upscaling, so every mask reaching this function is
 * 2x2-block-aligned, and a 2x2 block has exactly two cells of each colour
 * regardless of where it sits on the grid — so a block-aligned region always
 * has an exact 0 imbalance. Measured directly in parity.test.ts's guard test
 * rather than assumed. This function exists in full anyway because a
 * non-block-aligned silhouette source, or a future change to repair, can
 * reintroduce an imbalance, and the postcondition in `docs/CONTRACTS.md`
 * must hold regardless of how the mask arrived.
 */

import { DIRECTIONS, NO_CELL, parityOf, step } from '../grid.js';
import type { Direction, Mask } from '../types.js';
import { MaskRepairError } from './errors.js';

/** `unvisited` may mark at most this many cells (docs/CONTRACTS.md). */
const MAX_UNVISITED_CELLS = 3;

/**
 * Marks the minimum set of `inside` cells `unvisited` so that the resulting
 * `|black - white|` (over `inside && !unvisited` cells) is at most 1.
 *
 * Minimality: if the current imbalance is `d`, `|d| - 1` cells are removed
 * from the majority colour — enough to bring the imbalance down to exactly
 * `sign(d)`, never further. Removing more (e.g. all the way to 0) or
 * removing from the minority colour would both violate "minimum set".
 *
 * Every removed cell is chosen so the remaining path-cell region stays a
 * single 4-connected component: an articulation-point check runs before
 * each removal, recomputed fresh every round against the region as it
 * stands after the previous ones — a cell that was safe can become a cut
 * vertex once a neighbour of it is gone, so a table computed once up front
 * goes stale (parity.test.ts has a two-round fixture where a stale table
 * picks a cell that splits the region and a fresh one does not). Throws if
 * more than `MAX_UNVISITED_CELLS` cells would be needed in total (`d` too
 * large to absorb) — the one case `docs/CONTRACTS.md` and the issue require
 * "fail loudly" for, matched to `repair.ts`'s throw style.
 *
 * It can also throw if, at some round, no majority-colour cell is safe to
 * remove — but that is provably unreachable, not merely rare, so this
 * second throw is a defensive assertion against an internal invariant
 * violation rather than a required failure mode. Proof: take a spanning
 * tree T of whichever connected component of the region a candidate would
 * come from. Adjacent grid cells always differ under `parityOf`, so every
 * edge of T joins a black cell to a white one; summing tree-degree over
 * that component's majority colour therefore equals |E(T)|, i.e. the
 * component's cell count minus 1. If every majority cell had tree-degree
 * >= 2, that sum would be at least twice the majority count, forcing
 * majority <= minority - 1 — which contradicts it being the majority. So
 * some majority cell is a T-leaf, and a spanning-tree leaf can never be a
 * cut vertex of the graph it spans (removing it still leaves the rest of T
 * spanning, and connected). If every component had its minority in the
 * lead, the region's overall majority could not lead either, so some
 * component always has its majority at least tied with its minority. And
 * absorption only ever runs a round while the majority leads by >= 2 (it
 * stops the round `|d|` would reach 1) — so a safe cell always exists.
 *
 * A tileable region (one `classifyTiling`, in `../path/tiling.js`, accepts)
 * always has an exact 0 imbalance, because every 2x2 block it is built from
 * contributes exactly two cells of each colour no matter where the block
 * sits. Minimal absorption only ever reduces `|d|` to 1, never to 0 — so
 * whenever this function actually removes a cell, the result is provably
 * never tileable, for any choice of cell. There is therefore nothing to
 * prefer among candidates on that basis; `parity.test.ts` checks this
 * consequence directly rather than searching for a tileable choice that
 * cannot exist.
 */
export function absorbParity(mask: Mask): Mask {
  const { width, height, inside, unvisited } = mask;
  const size = width * height;

  const alive = new Uint8Array(size);
  let black = 0;
  let white = 0;
  let existingUnvisited = 0;
  for (let i = 0; i < size; i++) {
    if (inside[i] !== 1) continue;
    if (unvisited[i] === 1) {
      existingUnvisited++;
      continue;
    }
    alive[i] = 1;
    if (parityOf(i, width) === 0) black++;
    else white++;
  }

  const imbalance = black - white;
  if (Math.abs(imbalance) <= 1) return mask;

  const needed = Math.abs(imbalance) - 1;
  if (existingUnvisited + needed > MAX_UNVISITED_CELLS) {
    throw new MaskRepairError(
      `checkerboard parity absorption needs ${needed} more cell(s) on top of ` +
        `${existingUnvisited} already unvisited to bring |black - white| (currently ` +
        `${Math.abs(imbalance)}) within 1, exceeding the ${MAX_UNVISITED_CELLS}-cell limit — ` +
        'the silhouette needs to change, this cannot be absorbed',
    );
  }

  const majorityParity: 0 | 1 = imbalance > 0 ? 0 : 1;
  const outUnvisited = unvisited.slice();

  for (let round = 0; round < needed; round++) {
    const isArticulation = findArticulationPoints(alive, width, height);
    let chosen = NO_CELL;
    for (let i = 0; i < size; i++) {
      if (alive[i] !== 1 || isArticulation[i] === 1) continue;
      if (parityOf(i, width) !== majorityParity) continue;
      chosen = i;
      break;
    }
    if (chosen === NO_CELL) {
      // See this function's doc comment for the proof that this cannot
      // actually happen; kept as a defensive assertion, not a real case.
      throw new MaskRepairError(
        `checkerboard parity absorption could not find a majority-colour cell (round ` +
          `${round + 1} of ${needed}) whose removal keeps the region a single connected piece ` +
          '— this should be unreachable',
      );
    }
    alive[chosen] = 0;
    outUnvisited[chosen] = 1;
  }

  let pathCellCount = 0;
  for (let i = 0; i < size; i++) if (alive[i] === 1) pathCellCount++;

  return { width, height, inside, unvisited: outUnvisited, pathCellCount };
}

/**
 * Articulation points of the 4-connected graph over `alive` cells (Tarjan's
 * algorithm). Iterative, not recursive: a 100x100 mask can have 10,000 cells
 * on one DFS branch, which would overflow the call stack in a recursive
 * implementation. The explicit `stack` of cell indices plays the role of the
 * call stack; `nextDir` records, per cell, which of its 4 neighbours the DFS
 * has already explored, so re-visiting the top of `stack` resumes exactly
 * where it left off instead of restarting the neighbour scan.
 */
function findArticulationPoints(alive: Uint8Array, width: number, height: number): Uint8Array {
  const size = width * height;
  const disc = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const parent = new Int32Array(size).fill(NO_CELL);
  const nextDir = new Uint8Array(size);
  const isArticulation = new Uint8Array(size);
  let timer = 0;

  for (let start = 0; start < size; start++) {
    if (alive[start] !== 1 || disc[start] !== -1) continue;

    let rootChildren = 0;
    disc[start] = timer;
    low[start] = timer;
    timer++;
    nextDir[start] = 0;
    const stack: number[] = [start];

    while (stack.length > 0) {
      const node = stack[stack.length - 1] as number;
      const dirIdx = nextDir[node] as number;
      if (dirIdx < DIRECTIONS.length) {
        nextDir[node] = dirIdx + 1;
        const dir = DIRECTIONS[dirIdx] as Direction;
        const neighbour = step(node, dir, width, height);
        if (neighbour === NO_CELL || alive[neighbour] !== 1 || neighbour === parent[node]) {
          continue;
        }
        if (disc[neighbour] === -1) {
          parent[neighbour] = node;
          if (node === start) rootChildren++;
          disc[neighbour] = timer;
          low[neighbour] = timer;
          timer++;
          nextDir[neighbour] = 0;
          stack.push(neighbour);
        } else {
          low[node] = Math.min(low[node] as number, disc[neighbour] as number);
        }
      } else {
        stack.pop();
        const p = parent[node] as number;
        if (p !== NO_CELL) {
          low[p] = Math.min(low[p] as number, low[node] as number);
          if (p !== start && (low[node] as number) >= (disc[p] as number)) {
            isArticulation[p] = 1;
          }
        }
      }
    }

    if (rootChildren > 1) isArticulation[start] = 1;
  }

  return isArticulation;
}
