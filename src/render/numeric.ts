/**
 * The argument guards the render modules share. A caller across the render
 * boundary hands these whatever the platform gave it — `devicePixelRatio`, a
 * layout measurement, a pinch distance ratio — so a non-finite or
 * out-of-range value is rejected at the seam rather than turning every pixel
 * <-> cell conversion downstream into `NaN` or `Infinity`.
 */

export function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

export function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** As `requirePositiveFinite`, but zero is a legitimate size — a canvas mid-layout, not caller error. */
export function requireNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number, got ${value}`);
  }
}
