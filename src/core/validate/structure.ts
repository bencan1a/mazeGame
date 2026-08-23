/**
 * `occupancy` and the per-segment CSR must agree in both directions: every
 * occupied cell is listed by its segment, and every cell a segment lists is
 * occupied by it, in order, as a connected walk.
 */

import { directionBetween } from '../grid.js';
import type { Board } from '../types.js';
import { BoardInvariantError } from '../types.js';
import { isDirection } from './rayBlockers.js';

export function checkStructure(board: Board): void {
  const n = board.segmentCount;
  const size = board.width * board.height;

  if (n <= 0) {
    throw new BoardInvariantError(`board has ${n} segments, expected at least 1`);
  }
  checkArrayLengths(board, n, size);
  checkCsrOffsets(board, n);

  // occupancy -> CSR
  let covered = 0;
  for (let cell = 0; cell < size; cell++) {
    const id = board.occupancy[cell] as number;
    if (id === 0) continue;
    covered++;
    if (id < 1 || id > n) {
      throw new BoardInvariantError(
        `cell ${cell} occupancy is ${id}, which is not a valid segment id (1..${n})`,
        { cell, occupancy: id },
      );
    }
  }

  // CSR -> occupancy
  let listedCells = 0;
  for (let id = 1; id <= n; id++) {
    const from = board.segStart[id - 1] as number;
    const to = board.segStart[id] as number;
    if (to <= from) {
      throw new BoardInvariantError(
        `segment ${id} is empty (segStart[${id - 1}..${id}] = [${from}, ${to}])`,
        {
          segment: id,
        },
      );
    }
    listedCells += to - from;

    for (let k = from; k < to; k++) {
      const cell = board.segCells[k] as number;
      if (cell < 0 || cell >= size) {
        throw new BoardInvariantError(
          `segment ${id} lists cell ${cell}, outside the ${size}-cell grid`,
          {
            segment: id,
            cell,
          },
        );
      }
      if (board.occupancy[cell] !== id) {
        throw new BoardInvariantError(
          `segment ${id} claims cell ${cell} but occupancy says ${board.occupancy[cell] as number}`,
          { segment: id, cell, occupancy: board.occupancy[cell] },
        );
      }
      if (k > from) {
        const prev = board.segCells[k - 1] as number;
        if (directionBetween(prev, cell, board.width) === -1) {
          throw new BoardInvariantError(
            `segment ${id} is not a connected walk: cell ${prev} and cell ${cell} are not 4-neighbours`,
            { segment: id, from: prev, to: cell },
          );
        }
      }
    }

    // segCells runs tail -> head, so the head is the last cell and segDir is
    // the stroke that arrives at it.
    const head = board.segCells[to - 1] as number;
    if (board.segHead[id - 1] !== head) {
      throw new BoardInvariantError(
        `segment ${id} head is recorded as ${board.segHead[id - 1] as number}, but its last cell is ${head}`,
        { segment: id, segHead: board.segHead[id - 1], lastCell: head },
      );
    }

    const dir = board.segDir[id - 1] as number;
    if (!isDirection(dir)) {
      throw new BoardInvariantError(
        `segment ${id} has direction ${dir}, which is not one of 0..3`,
        {
          segment: id,
          segDir: dir,
        },
      );
    }
    if (to - from >= 2) {
      const before = board.segCells[to - 2] as number;
      const stroke = directionBetween(before, head, board.width);
      if (stroke !== dir) {
        throw new BoardInvariantError(
          `segment ${id} exits in direction ${dir} but its terminal stroke is ${stroke}`,
          { segment: id, segDir: dir, terminalStroke: stroke },
        );
      }
    }

    // A head on the border pointing outward has no blockers at all, which is
    // legal, so nothing further is checked here.
  }

  if (covered !== listedCells) {
    throw new BoardInvariantError(
      `${covered} cells are occupied but the segment CSR lists ${listedCells} cells`,
      { covered, listed: listedCells },
    );
  }
}

function checkArrayLengths(board: Board, n: number, size: number): void {
  if (board.occupancy.length !== size) {
    throw new BoardInvariantError(
      `occupancy has ${board.occupancy.length} cells, expected ${size}`,
    );
  }
  if (board.segStart.length !== n + 1) {
    throw new BoardInvariantError(
      `segStart has ${board.segStart.length} entries, expected ${n + 1}`,
    );
  }
  if (board.segHead.length !== n) {
    throw new BoardInvariantError(`segHead has ${board.segHead.length} entries, expected ${n}`);
  }
  if (board.segDir.length !== n) {
    throw new BoardInvariantError(`segDir has ${board.segDir.length} entries, expected ${n}`);
  }
  if (board.segColor.length !== n) {
    throw new BoardInvariantError(`segColor has ${board.segColor.length} entries, expected ${n}`);
  }
  if (board.edgeStart.length !== n + 1) {
    throw new BoardInvariantError(
      `edgeStart has ${board.edgeStart.length} entries, expected ${n + 1}`,
    );
  }
}

function checkCsrOffsets(board: Board, n: number): void {
  if (board.segStart[0] !== 0) {
    throw new BoardInvariantError(`segStart[0] is ${board.segStart[0] as number}, expected 0`);
  }
  if (board.segStart[n] !== board.segCells.length) {
    throw new BoardInvariantError(
      `segStart[${n}] is ${board.segStart[n] as number}, but segCells has ${board.segCells.length} entries`,
    );
  }
  if (board.edgeStart[0] !== 0) {
    throw new BoardInvariantError(`edgeStart[0] is ${board.edgeStart[0] as number}, expected 0`);
  }
  if (board.edgeStart[n] !== board.edgeTarget.length) {
    throw new BoardInvariantError(
      `edgeStart[${n}] is ${board.edgeStart[n] as number}, but edgeTarget has ${board.edgeTarget.length} entries`,
    );
  }
  // Non-decreasing, or a segment's slice [from, to) is not a valid range.
  for (let id = 1; id <= n; id++) {
    if ((board.segStart[id] as number) < (board.segStart[id - 1] as number)) {
      throw new BoardInvariantError(`segStart is not non-decreasing at segment ${id}`, {
        segment: id,
      });
    }
    if ((board.edgeStart[id] as number) < (board.edgeStart[id - 1] as number)) {
      throw new BoardInvariantError(`edgeStart is not non-decreasing at segment ${id}`, {
        segment: id,
      });
    }
  }
}
