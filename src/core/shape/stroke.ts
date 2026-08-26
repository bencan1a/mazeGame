/**
 * Sets the stroke width by dilating the resampled ink, rather than by how far
 * the drawing had to scale to reach the target resolution.
 */

/**
 * Chebyshev (8-neighbour) dilation, one cell of growth per pass: after
 * `radius` passes a stroke gains `radius` cells on every side.
 */
export function dilateChebyshev(
  ink: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  let current = ink;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        next[y * width + x] = hasInkNeighbour(current, width, height, x, y) ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

function hasInkNeighbour(
  ink: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      if (ink[ny * width + nx] === 1) return true;
    }
  }
  return false;
}

/**
 * The dilation radius that grows a one-cell-wide line to about `strokeWidth`
 * cells: `radius` cells added on each side makes a line `2 * radius + 1`
 * cells wide.
 */
export function strokeRadius(strokeWidth: number): number {
  return Math.max(0, Math.floor((strokeWidth - 1) / 2));
}
