/** Grid index arithmetic. A cell is a single number, `y * width + x`. */

import type { CellIndex, Direction } from './types.js';

export const NORTH = 0 satisfies Direction;
export const EAST = 1 satisfies Direction;
export const SOUTH = 2 satisfies Direction;
export const WEST = 3 satisfies Direction;

export const DIRECTIONS: readonly Direction[] = [NORTH, EAST, SOUTH, WEST];

export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];

export const DIRECTION_NAMES: readonly string[] = ['N', 'E', 'S', 'W'];

export function toIndex(x: number, y: number, width: number): CellIndex {
  return y * width + x;
}

export function xOf(index: CellIndex, width: number): number {
  return index % width;
}

export function yOf(index: CellIndex, width: number): number {
  return Math.floor(index / width);
}

export function opposite(dir: Direction): Direction {
  return ((dir + 2) & 3) as Direction;
}

/** Direction travelled from `from` to `to`, or -1 if they are not neighbours. */
export function directionBetween(from: CellIndex, to: CellIndex, width: number): Direction | -1 {
  const dx = xOf(to, width) - xOf(from, width);
  const dy = yOf(to, width) - yOf(from, width);
  if (dx === 0 && dy === -1) return NORTH;
  if (dx === 1 && dy === 0) return EAST;
  if (dx === 0 && dy === 1) return SOUTH;
  if (dx === -1 && dy === 0) return WEST;
  return -1;
}

/** Returned by cell lookups that fall outside the grid. */
export const NO_CELL = -1;

/**
 * Neighbour of `index` in `dir`, or NO_CELL if that step leaves the grid.
 * Guards the row wrap that plain index arithmetic would silently allow.
 *
 * `dir` outside 0..3 also answers NO_CELL. It gets here despite the type: a
 * Direction stored in a Uint8Array loses it, and -1 reads back as 255. Without
 * the `undefined` guard the arithmetic yields NaN, every bounds comparison is
 * false for NaN, and the caller gets NaN rather than NO_CELL.
 */
export function step(index: CellIndex, dir: Direction, width: number, height: number): CellIndex {
  const dx = DX[dir];
  const dy = DY[dir];
  if (dx === undefined || dy === undefined) return NO_CELL;
  const x = (index % width) + dx;
  const y = Math.floor(index / width) + dy;
  if (x < 0 || y < 0 || x >= width || y >= height) return NO_CELL;
  return y * width + x;
}

export function isBorder(index: CellIndex, width: number, height: number): boolean {
  const x = index % width;
  const y = Math.floor(index / width);
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
}

/** Checkerboard colour of a cell: 0 or 1. */
export function parityOf(index: CellIndex, width: number): 0 | 1 {
  return (((index % width) + Math.floor(index / width)) & 1) as 0 | 1;
}

/**
 * Steps from `index` to the grid edge travelling in `dir`, exclusive of
 * `index`. NO_CELL for a `dir` outside 0..3, as `step()`.
 */
export function stepsToEdge(
  index: CellIndex,
  dir: Direction,
  width: number,
  height: number,
): number {
  const x = index % width;
  const y = Math.floor(index / width);
  switch (dir) {
    case NORTH:
      return y;
    case EAST:
      return width - 1 - x;
    case SOUTH:
      return height - 1 - y;
    case WEST:
      return x;
    default:
      return NO_CELL;
  }
}
