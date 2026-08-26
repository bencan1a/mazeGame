/**
 * Resamples a bitmap onto a different resolution: a target cell is ink when
 * any source cell in its footprint is ink, never an average or a nearest
 * sample, so a stroke thinner than one target cell cannot vanish between
 * samples.
 */
export function resampleAnyCovered(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(sourceHeight, Math.max(y0 + 1, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(sourceWidth, Math.max(x0 + 1, Math.floor((x + 1) * scaleX)));

      let hit = 0;
      for (let sy = y0; sy < y1 && hit === 0; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          if (source[sy * sourceWidth + sx] === 1) {
            hit = 1;
            break;
          }
        }
      }
      out[y * targetWidth + x] = hit;
    }
  }

  return out;
}
