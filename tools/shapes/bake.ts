/**
 * The bake itself: one SVG in, one 96x96 ink bitmap out. Curation and the
 * shipped asset both go through here, so what a shape was approved as is what
 * the player gets.
 */

import { fitInk } from './fit.js';
import { withStrokeWidth, withoutIntrinsicSize, type Rasteriser } from './raster.js';

/** The bake resolution the runtime resamples from. */
export const BAKE_EDGE = 96;
const RASTER_EDGE = 256;
const BAKE_STROKE_UNITS = 0.25;

export async function bakeInk(raster: Rasteriser, svg: string): Promise<Uint8Array> {
  const drawn = await raster.ink(
    withStrokeWidth(withoutIntrinsicSize(svg), BAKE_STROKE_UNITS, 24),
    RASTER_EDGE,
  );
  return fitInk(drawn, RASTER_EDGE, 0, BAKE_EDGE, BAKE_EDGE);
}
