/**
 * Synthetic `Mask` fixtures.
 *
 * `makeMask` is deliberately not a validator: it builds exactly the mask the
 * spec describes, including masks that violate the S1 postconditions, because
 * the validator's own failing cases have to come from somewhere. Use
 * `maskViolations` from ./postconditions.js to assert a mask is well formed.
 */

import type { Mask } from '../../src/core/types.js';
import { fromRows, toRows } from './art.js';

/** Inside the silhouette and on the path. */
export const INSIDE_CHAR = '#';
/** Outside the silhouette. */
export const OUTSIDE_CHAR = '.';
/** Inside the silhouette but deliberately left off the path (parity absorption). */
export const UNVISITED_CHAR = 'o';

export interface RectSpec {
  readonly width: number;
  readonly height: number;
}

/** ASCII art, or a plain rectangle with every cell inside. */
export type MaskSpec = string | RectSpec;

function isRectSpec(spec: MaskSpec): spec is RectSpec {
  return typeof spec !== 'string';
}

/**
 * Build a Mask from ASCII art (`#` inside, `.` outside, `o` inside-but-unvisited)
 * or from a plain rectangle.
 */
export function makeMask(spec: MaskSpec): Mask {
  if (isRectSpec(spec)) return makeRectMask(spec.width, spec.height);

  const rows = toRows(spec);
  const height = rows.length;
  const width = (rows[0] as string).length;
  const inside = new Uint8Array(width * height);
  const unvisited = new Uint8Array(width * height);
  let pathCellCount = 0;

  for (let y = 0; y < height; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < width; x++) {
      const char = row[x] as string;
      const i = y * width + x;
      switch (char) {
        case INSIDE_CHAR:
          inside[i] = 1;
          pathCellCount++;
          break;
        case UNVISITED_CHAR:
          inside[i] = 1;
          unvisited[i] = 1;
          break;
        case OUTSIDE_CHAR:
          break;
        default:
          throw new Error(
            `mask art has an unknown character ${JSON.stringify(char)} at (${x}, ${y}); ` +
              `expected one of "${INSIDE_CHAR}${OUTSIDE_CHAR}${UNVISITED_CHAR}"`,
          );
      }
    }
  }

  return { width, height, inside, unvisited, pathCellCount };
}

function makeRectMask(width: number, height: number): Mask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`rect mask needs positive integer dimensions, got ${width}x${height}`);
  }
  const inside = new Uint8Array(width * height).fill(1);
  const unvisited = new Uint8Array(width * height);
  return { width, height, inside, unvisited, pathCellCount: width * height };
}

/**
 * Render a Mask back to canonical ASCII art.
 * `renderMask(makeMask(spec)) === spec` for any canonical spec.
 */
export function renderMask(mask: Mask): string {
  const rows: string[] = [];
  for (let y = 0; y < mask.height; y++) {
    let row = '';
    for (let x = 0; x < mask.width; x++) {
      const i = y * mask.width + x;
      if (mask.inside[i] === 0) row += OUTSIDE_CHAR;
      else if (mask.unvisited[i] === 1) row += UNVISITED_CHAR;
      else row += INSIDE_CHAR;
    }
    rows.push(row);
  }
  return fromRows(rows);
}

/** A 4x4 rectangle. The smallest mask that is interesting and still hand-checkable. */
export const SQUARE_MASK: Mask = makeMask({ width: 4, height: 4 });

/** A non-convex silhouette: rays cross outside cells, which is the case that catches bugs. */
export const PLUS_MASK: Mask = makeMask(['.##.', '####', '####', '.##.'].join('\n'));

/**
 * Odd cell count, so the checkerboard is unbalanced 5:4 until the centre cell is
 * absorbed. This is the shape of the parity problem S1 exists to solve.
 */
export const UNVISITED_MASK: Mask = makeMask(['###', '#o#', '###'].join('\n'));
