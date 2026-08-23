/**
 * Separate from `validateBoard`, whose signature takes one board where
 * determinism is a statement about two generations from the same input.
 */

import type { Board } from '../types.js';
import { BoardInvariantError } from '../types.js';

/** Spelled out rather than derived so a field added to `Board` fails to
 * compile here instead of being silently skipped. */

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

/** Throws `BoardInvariantError` naming the first field that differs. */
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
