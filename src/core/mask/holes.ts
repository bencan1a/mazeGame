/**
 * An "outside" cell is a hole rather than background when it cannot reach the
 * grid border through other outside cells. Only holes at or below
 * `areaThreshold` cells are filled.
 */

import { DIRECTIONS, NO_CELL, isBorder, step } from '../grid.js';
import type { Blob } from './blob.js';

export function fillHoles(grid: Blob, areaThreshold: number): Blob {
  const { width, height, inside } = grid;
  const size = width * height;
  const reachesBorder = new Uint8Array(size);

  // Flood-fill every outside cell reachable from the border. Whatever is left
  // over among the outside cells is enclosed.
  const stack: number[] = [];
  for (let i = 0; i < size; i++) {
    if (inside[i] === 1 || reachesBorder[i] === 1 || !isBorder(i, width, height)) continue;
    reachesBorder[i] = 1;
    stack.push(i);
  }
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    for (const dir of DIRECTIONS) {
      const next = step(cell, dir, width, height);
      if (next === NO_CELL || inside[next] === 1 || reachesBorder[next] === 1) continue;
      reachesBorder[next] = 1;
      stack.push(next);
    }
  }

  const out = inside.slice();
  const visited = new Uint8Array(size);
  for (let start = 0; start < size; start++) {
    if (inside[start] === 1 || reachesBorder[start] === 1 || visited[start] === 1) continue;

    const members: number[] = [start];
    visited[start] = 1;
    const holeStack = [start];
    while (holeStack.length > 0) {
      const cell = holeStack.pop() as number;
      for (const dir of DIRECTIONS) {
        const next = step(cell, dir, width, height);
        if (next === NO_CELL || inside[next] === 1 || reachesBorder[next] === 1) continue;
        if (visited[next] === 1) continue;
        visited[next] = 1;
        members.push(next);
        holeStack.push(next);
      }
    }

    if (members.length <= areaThreshold) {
      for (const cell of members) out[cell] = 1;
    }
  }

  return { width, height, inside: out };
}
