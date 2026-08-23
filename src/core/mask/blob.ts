/**
 * Procedural blob generator (S1, issue #2; half-resolution rework, issue #58).
 *
 * The *raw* silhouette only — the first half of PRD §4.2 step 1. Output is
 * allowed to be disconnected or spurred; largest-component extraction, opening,
 * hole fill (#3) and parity absorption (#4) are separate stages, so this file
 * does not satisfy the `Mask` postconditions in docs/CONTRACTS.md.
 *
 * The silhouette is drawn on a half-resolution lattice and each cell upscaled
 * into a 2x2 block. That is what makes every region block-aligned to lattice
 * offset (0, 0) by construction, which the contour path fill (#5) requires; an
 * organic boundary drawn at full resolution essentially never tiles (measured
 * 0/300 on the previous full-resolution generator). The accepted trade is an
 * outline pixelated at 2-cell rather than 1-cell resolution — the harmonics
 * still run on the half-resolution lattice, so the shape is coarser in outline,
 * not simpler.
 */

import { toIndex } from '../grid.js';
import { createRng, type Rng } from '../rng.js';
import type { Seed } from '../types.js';

export interface BlobParams {
  /** Square board edge length. See GenParams.gridSize. */
  readonly gridSize: number;
  readonly seed: Seed;
  /**
   * Target fraction of the grid the raw blob should occupy, before repair
   * trims it. Clamped rather than rejected at the extremes: near 0 is
   * near-empty and near 1 looks rectangular, but both are safe — repair
   * downstream assumes no particular fraction survived.
   */
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

/**
 * Half of `gridSize`, rounded down, floored to 1. The PRD's grid-size range
 * (20..100, ADR-0006) does not promise even numbers, so odd sizes round down
 * and leave a full-resolution row and column past `2 * halfSize` outside the
 * lattice; `upscale2x` never writes there, so that strip stays outside the
 * silhouette. The floor of 1 keeps `gridSize` 1 non-empty; 0 is rejected by
 * `generateBlob`.
 */
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

/**
 * The lattice is a parameter so that mask repair (#3) can run at half
 * resolution too, before the upscale. That ordering is the intended one:
 * erosion or dilation on an already-upscaled region can shave one cell off a
 * 2x2 block and break the alignment `upscale2x` guarantees, where the same
 * operation at half resolution stays in whole-block units. Nothing enforces
 * the ordering yet — this only avoids foreclosing it.
 */
function generateRadialBlob(width: number, height: number, rng: Rng, fillFraction: number): Blob {
  // Drawn before fillFraction is read, so lobe count, position and depth
  // depend on the seed alone. fillFraction then scales the shape — but not
  // purely, since the centre jitter below is a fraction of baseRadius. Area is
  // therefore monotone in fillFraction only empirically; blob.test.ts asserts
  // it rather than the construction guaranteeing it.
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

  // Non-empty by construction rather than by likelihood. Forcing it here
  // rather than after the upscale is enough: a forced-inside half-resolution
  // cell upscales to a forced-inside 2x2 block.
  const centreX = clampIndex(Math.round(cx - 0.5), width);
  const centreY = clampIndex(Math.round(cy - 0.5), height);
  inside[toIndex(centreX, centreY, width)] = 1;

  return { width, height, inside };
}

/**
 * Maps every `half` cell to the 2x2 block at `(2*hx, 2*hy)`, which is what
 * makes the output block-aligned to lattice offset (0, 0) unconditionally —
 * the contour path fill (#5) then succeeds on its first offset.
 *
 * `fullWidth`/`fullHeight` may exceed twice the half dimensions when
 * `gridSize` is odd. The leftover row and column are never written, so they
 * stay outside and can never become a path cell no 2x2 block covers.
 */
function upscale2x(half: Blob, fullWidth: number, fullHeight: number): Blob {
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
