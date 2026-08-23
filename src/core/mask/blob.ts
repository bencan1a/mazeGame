import { toIndex } from '../grid.js';
import { createRng, type Rng } from '../rng.js';
import type { Seed } from '../types.js';

export interface BlobParams {
  /** Square board edge length. */
  readonly gridSize: number;
  readonly seed: Seed;
  /** Target fraction of the grid the raw blob occupies. Clamped, not rejected. */
  readonly fillFraction?: number;
}

/** A raw binary silhouette, before mask repair. */
export interface Blob {
  readonly width: number;
  readonly height: number;
  /** 1 = inside the raw silhouette, 0 = outside. */
  readonly inside: Uint8Array;
}

const MIN_FILL_FRACTION = 0.05;
const MAX_FILL_FRACTION = 0.85;
const DEFAULT_FILL_FRACTION = 0.45;

// Enough to break both circular and rectangular symmetry, but not so many that
// neighbouring lobes cancel back out into a near-constant radius.
const MIN_HARMONICS = 3;
const MAX_HARMONICS = 6;

const MIN_AMPLITUDE_FRACTION = 0.12;
const MAX_AMPLITUDE_FRACTION = 0.4;

// Without a floor, destructive interference between harmonics can push the
// radius through zero and fold the boundary back on itself, fragmenting the
// blob instead of carving an inlet into it.
const MIN_RADIUS_FRACTION = 0.2;

interface Harmonic {
  readonly frequency: number;
  readonly amplitudeFraction: number;
  readonly phase: number;
}

/** Floored to 1 so that `gridSize` 1 still has a lattice to draw on. */
function halfResSize(gridSize: number): number {
  return Math.max(1, Math.floor(gridSize / 2));
}

export function generateBlob(params: BlobParams): Blob {
  const { gridSize } = params;
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error(`gridSize must be a positive integer, got ${gridSize}`);
  }
  // NaN survives clamp() and poisons the radius and centre: every distance
  // test is false and the non-empty fallback writes to inside[NaN], a silent
  // no-op on a Uint8Array, yielding the all-zero mask this must never return.
  if (params.fillFraction !== undefined && !Number.isFinite(params.fillFraction)) {
    throw new Error(`fillFraction must be a finite number, got ${params.fillFraction}`);
  }
  const fillFraction = clamp(
    params.fillFraction ?? DEFAULT_FILL_FRACTION,
    MIN_FILL_FRACTION,
    MAX_FILL_FRACTION,
  );

  const rng = createRng(params.seed);
  const halfSize = halfResSize(gridSize);
  const half = generateRadialBlob(halfSize, halfSize, rng, fillFraction);
  return upscale2x(half, gridSize, gridSize);
}

function generateRadialBlob(width: number, height: number, rng: Rng, fillFraction: number): Blob {
  // Drawn before fillFraction is read, so lobe count, position and depth
  // depend on the seed alone.
  const harmonicCount = MIN_HARMONICS + rng.int(MAX_HARMONICS - MIN_HARMONICS + 1);
  const harmonics: Harmonic[] = [];
  for (let k = 0; k < harmonicCount; k++) {
    harmonics.push({
      // Fixed, not random: two random frequencies can land close together and
      // beat, flattening the boundary instead of lobing it.
      frequency: k + 2,
      // Divided by sqrt(count) so harmonics that happen to sum in phase at
      // some angle still bound the worst-case bulge.
      amplitudeFraction:
        rng.range(MIN_AMPLITUDE_FRACTION, MAX_AMPLITUDE_FRACTION) / Math.sqrt(harmonicCount),
      phase: rng.range(0, Math.PI * 2),
    });
  }

  // A disc of this radius has the requested area; the harmonics then perturb
  // it into a lobed shape of roughly, not exactly, that area.
  const baseRadius = Math.sqrt((fillFraction * width * height) / Math.PI);

  // Scaled to the blob so an off-centre silhouette still stays in view.
  const jitter = baseRadius * 0.1;
  const cx = width / 2 + rng.range(-jitter, jitter);
  const cy = height / 2 + rng.range(-jitter, jitter);

  const inside = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const theta = Math.atan2(dy, dx);
      if (dist <= radiusAt(theta, baseRadius, harmonics)) {
        inside[toIndex(x, y, width)] = 1;
      }
    }
  }

  // Non-empty by construction rather than by likelihood.
  const centreX = clampIndex(Math.round(cx - 0.5), width);
  const centreY = clampIndex(Math.round(cy - 0.5), height);
  inside[toIndex(centreX, centreY, width)] = 1;

  return { width, height, inside };
}

/**
 * Maps every `half` cell to the 2x2 block at `(2*hx, 2*hy)`.
 *
 * `fullWidth`/`fullHeight` may exceed twice the half dimensions when the grid
 * size is odd; the leftover row and column are left as they came in.
 */
export function upscale2x(half: Blob, fullWidth: number, fullHeight: number): Blob {
  const inside = new Uint8Array(fullWidth * fullHeight);
  for (let hy = 0; hy < half.height; hy++) {
    const fy0 = hy * 2;
    if (fy0 >= fullHeight) continue;
    const fy1 = fy0 + 1;
    for (let hx = 0; hx < half.width; hx++) {
      if (half.inside[toIndex(hx, hy, half.width)] !== 1) continue;
      const fx0 = hx * 2;
      if (fx0 >= fullWidth) continue;
      const fx1 = fx0 + 1;

      inside[toIndex(fx0, fy0, fullWidth)] = 1;
      if (fx1 < fullWidth) inside[toIndex(fx1, fy0, fullWidth)] = 1;
      if (fy1 < fullHeight) {
        inside[toIndex(fx0, fy1, fullWidth)] = 1;
        if (fx1 < fullWidth) inside[toIndex(fx1, fy1, fullWidth)] = 1;
      }
    }
  }
  return { width: fullWidth, height: fullHeight, inside };
}

function radiusAt(theta: number, baseRadius: number, harmonics: readonly Harmonic[]): number {
  let r = baseRadius;
  for (const h of harmonics) {
    r += h.amplitudeFraction * baseRadius * Math.cos(h.frequency * theta + h.phase);
  }
  return Math.max(r, baseRadius * MIN_RADIUS_FRACTION);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampIndex(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}
