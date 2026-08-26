/**
 * The seam between a drawing and the board cut from it: which seed a shape
 * opens on, and how its baked bitmap becomes a silhouette the generator can
 * take.
 */

import type { GenerateBoardOptions } from '../core/generate.js';
import { repairMask } from '../core/mask/index.js';
import { createRng } from '../core/rng.js';
import { importShape } from '../core/shape/index.js';
import { DEFAULT_GEN_PARAMS, type GenParams, type Mask } from '../core/types.js';

/** A shape's baked bitmap: 1 = ink, `edge` square, row-major. */
export interface ShapeDrawing {
  readonly ink: Uint8Array;
  readonly edge: number;
}

/**
 * The seed a shape's board opens on. Chains the shared seeded generator
 * through every character rather than inventing a hash of its own: each
 * character re-seeds it, so two ids diverge at their first differing
 * character and the same id always lands on the same seed.
 */
export function seedForShape(shapeId: string): number {
  let seed = 0;
  for (let i = 0; i < shapeId.length; i++) {
    seed = createRng((seed + shapeId.charCodeAt(i)) >>> 0).int(0x100000000);
  }
  return seed;
}

/** With no shape chosen the generator draws a procedural blob, as it always has. */
export function genParamsForShape(shapeId: string | null): GenParams {
  if (shapeId === null) return DEFAULT_GEN_PARAMS;
  return { ...DEFAULT_GEN_PARAMS, seed: seedForShape(shapeId) };
}

/** Every enclosed void in a drawing is a face the player fills, so nothing is filled in as a hole. */
const SHAPE_REPAIR = { holeAreaThreshold: 0 } as const;

export function shapeGenerateOptions(
  drawing: ShapeDrawing,
  gridSize: number,
): GenerateBoardOptions {
  const imported = importShape({
    ink: drawing.ink,
    sourceWidth: drawing.edge,
    sourceHeight: drawing.edge,
    gridSize,
  });
  if (!imported.ok) {
    throw new Error(`this drawing has no enclosed face to fill at ${gridSize}x${gridSize}`);
  }
  return { silhouette: imported.blob, repair: SHAPE_REPAIR };
}

/**
 * The cells a board cut from this drawing would fill, for anything that wants
 * to show the shape without generating it. Runs the same import and the same
 * repair the generator will, at the same grid size, so what it shows and what
 * plays cannot disagree.
 */
export function shapeFaceMask(drawing: ShapeDrawing, gridSize: number): Mask | null {
  const imported = importShape({
    ink: drawing.ink,
    sourceWidth: drawing.edge,
    sourceHeight: drawing.edge,
    gridSize,
  });
  if (!imported.ok) return null;
  try {
    return repairMask(imported.blob, SHAPE_REPAIR);
  } catch {
    return null;
  }
}
