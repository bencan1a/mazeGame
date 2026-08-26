/**
 * Placing a baked drawing in a frame: rotate, fit, then set the stroke width by
 * dilation rather than by how far the drawing had to scale.
 */

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function inkBounds(ink: Uint8Array, edge: number): Bounds {
  let minX = edge;
  let minY = edge;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      if (ink[y * edge + x] !== 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Inverse-mapped so every target cell is filled: rotate the target cell back
 * into the bake and take any ink in its preimage, which keeps a hairline
 * stroke from dropping out between samples.
 */
export function fitInk(
  ink: Uint8Array,
  edge: number,
  angle: number,
  width: number,
  height: number,
): Uint8Array {
  const bounds = inkBounds(ink, edge);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  let spanX = 0;
  let spanY = 0;
  for (const [px, py] of [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.maxY],
  ] as const) {
    const rx = Math.abs((px - cx) * cos - (py - cy) * sin);
    const ry = Math.abs((px - cx) * sin + (py - cy) * cos);
    if (rx > spanX) spanX = rx;
    if (ry > spanY) spanY = ry;
  }

  const scale = Math.min((width - 2) / (2 * spanX), (height - 2) / (2 * spanY));
  const out = new Uint8Array(width * height);
  const samples = [0.25, 0.5, 0.75];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (const sy of samples) {
        for (const sx of samples) {
          const tx = (x + sx - width / 2) / scale;
          const ty = (y + sy - height / 2) / scale;
          const ux = tx * cos + ty * sin + cx;
          const uy = -tx * sin + ty * cos + cy;
          const px = Math.round(ux);
          const py = Math.round(uy);
          if (px < 0 || py < 0 || px >= edge || py >= edge) continue;
          if (ink[py * edge + px] === 1) {
            hit = 1;
            break;
          }
        }
        if (hit === 1) break;
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/** Chebyshev dilation: the stroke width the player sees, set after fitting. */
export function dilateInk(
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
        let hit = 0;
        for (let dy = -1; dy <= 1 && hit === 0; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (current[ny * width + nx] === 1) {
              hit = 1;
              break;
            }
          }
        }
        next[y * width + x] = hit;
      }
    }
    current = next;
  }
  return current;
}
