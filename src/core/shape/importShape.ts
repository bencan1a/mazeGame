/**
 * A baked line-art drawing in, a `Blob` ready for `repairMask` out. Ink is the
 * drawing and stays empty; the enclosed faces between strokes become the
 * lobes a player fills.
 */

import type { Blob } from '../mask/index.js';
import { extractFaces } from './faces.js';
import { resampleAnyCovered } from './resample.js';
import { dilateChebyshev, strokeRadius } from './stroke.js';

export interface ShapeImportParams {
  /** 1 = ink, 0 = empty. Row-major, `sourceWidth * sourceHeight` long. */
  readonly ink: Uint8Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Square board edge length the output blob is resampled to. */
  readonly gridSize: number;
  /**
   * Stroke width in board cells, after resampling. Defaults to
   * `DEFAULT_STROKE_WIDTH`, the floor a stroke needs to survive
   * `repairMask`'s half-resolution downsample when dilated after resampling
   * rather than rasterised directly at board size.
   */
  readonly strokeWidth?: number;
}

export type ShapeImportResult =
  | { readonly ok: true; readonly blob: Blob; readonly faceCount: number }
  | { readonly ok: false; readonly reason: 'leaked' };

export const DEFAULT_STROKE_WIDTH = 3;

export function importShape(params: ShapeImportParams): ShapeImportResult {
  const { ink, sourceWidth, sourceHeight, gridSize } = params;
  const strokeWidth = params.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  validateParams(ink, sourceWidth, sourceHeight, gridSize, strokeWidth);

  const resampled = resampleAnyCovered(ink, sourceWidth, sourceHeight, gridSize, gridSize);
  const thickened = dilateChebyshev(resampled, gridSize, gridSize, strokeRadius(strokeWidth));
  const faces = extractFaces(thickened, gridSize, gridSize);

  if (faces.faceCount === 0) return { ok: false, reason: 'leaked' };
  return {
    ok: true,
    blob: { width: gridSize, height: gridSize, inside: faces.inside },
    faceCount: faces.faceCount,
  };
}

function validateParams(
  ink: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  gridSize: number,
  strokeWidth: number,
): void {
  if (!Number.isInteger(sourceWidth) || sourceWidth < 1) {
    throw new Error(`sourceWidth must be a positive integer, got ${sourceWidth}`);
  }
  if (!Number.isInteger(sourceHeight) || sourceHeight < 1) {
    throw new Error(`sourceHeight must be a positive integer, got ${sourceHeight}`);
  }
  if (ink.length !== sourceWidth * sourceHeight) {
    throw new Error(
      `ink length ${ink.length} does not match sourceWidth * sourceHeight ` +
        `(${sourceWidth} * ${sourceHeight} = ${sourceWidth * sourceHeight})`,
    );
  }
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error(`gridSize must be a positive integer, got ${gridSize}`);
  }
  if (!Number.isInteger(strokeWidth) || strokeWidth < 1) {
    throw new Error(`strokeWidth must be a positive integer, got ${strokeWidth}`);
  }
}
