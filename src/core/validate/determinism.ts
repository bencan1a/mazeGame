/**
 * Determinism: regenerating from the same `(seed, params)` must give
 * byte-identical arrays (CONTRACTS.md "validation", ADR-0004).
 *
 * `validateBoard(board, mask)` cannot check this itself — its signature takes
 * one board, and determinism is a statement about *two* generations from the
 * same input. `generateBoard` (#14) does not exist yet in this stream's scope,
 * so this file provides the comparison half honestly rather than faking the
 * other half: `assertDeterministic(a, b)` is the assertion #14 should run as
 * `assertDeterministic(generateBoard(params), generateBoard(params))` once it
 * lands. Wiring it into the actual generator call is #14's work, not
 * simulated here.
 */

import type { Board } from '../types.js';
import { BoardInvariantError } from '../types.js';

/** Every typed-array field of Board, spelled out rather than derived, so a
 * field added to the shared type here fails loudly (TS error) instead of
 * silently skipping the new array. */
const ARRAY_FIELDS = [
  'occupancy',
  'segStart',
  'segCells',
  'segHead',
  'segDir',
  'edgeStart',
  'edgeTarget',
  'segColor',
] as const satisfies readonly (keyof Board)[];

/**
 * Assert two boards generated from what should be the same `(seed, params)`
 * are byte-identical: same scalars, and every typed array equal element for
 * element. Throws `BoardInvariantError` naming the first field that differs.
 */
export function assertDeterministic(a: Board, b: Board): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new BoardInvariantError(
      `boards are not deterministic: size ${a.width}x${a.height} vs ${b.width}x${b.height}`,
      { a: { width: a.width, height: a.height }, b: { width: b.width, height: b.height } },
    );
  }
  if (a.segmentCount !== b.segmentCount) {
    throw new BoardInvariantError(
      `boards are not deterministic: segmentCount ${a.segmentCount} vs ${b.segmentCount}`,
      { a: a.segmentCount, b: b.segmentCount },
    );
  }

  const paramKeys = Object.keys(a.params) as (keyof Board['params'])[];
  for (const key of paramKeys) {
    if (a.params[key] !== b.params[key]) {
      throw new BoardInvariantError(
        `boards are not deterministic: params.${key} is ${a.params[key]} vs ${b.params[key]}`,
        { field: `params.${key}`, a: a.params[key], b: b.params[key] },
      );
    }
  }

  for (const field of ARRAY_FIELDS) {
    const arrA = a[field];
    const arrB = b[field];
    if (arrA.length !== arrB.length) {
      throw new BoardInvariantError(
        `boards are not deterministic: ${field} has ${arrA.length} entries vs ${arrB.length}`,
        { field, lengthA: arrA.length, lengthB: arrB.length },
      );
    }
    for (let i = 0; i < arrA.length; i++) {
      if (arrA[i] !== arrB[i]) {
        throw new BoardInvariantError(
          `boards are not deterministic: ${field}[${i}] is ${arrA[i]} vs ${arrB[i]}`,
          { field, index: i, a: arrA[i], b: arrB[i] },
        );
      }
    }
  }
}
