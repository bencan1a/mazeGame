/**
 * Procedural blob generator (S1, issue #2).
 *
 * This is the *raw* silhouette only: the first half-step of `docs/PRD.md`
 * §4.2 step 1 ("rasterize / generate blob to binary grid"). It hands a binary
 * region to the mask-repair pipeline, which is separate work (#3 largest
 * component + morphological open + hole fill, #4 parity absorption). A raw
 * blob is explicitly allowed to be disconnected or spurred here — fixing that
 * is what #3 exists for — so this module does not attempt to satisfy the full
 * `Mask` postconditions in `docs/CONTRACTS.md`.
 *
 * Shape: a radial silhouette around a (slightly jittered) centre, whose
 * boundary radius at each angle is a base radius perturbed by a handful of
 * independent random sinusoidal harmonics. A handful of harmonics with
 * independent random frequency, phase and amplitude reliably produces lobes
 * and concavities, so the result is neither a disc (constant radius) nor a
 * rectangle (axis-aligned boundary) for any seed — see blob.test.ts for the
 * property tests that pin this down.
 */

import { toIndex } from '../grid.js';
import { createRng } from '../rng.js';
import type { Seed } from '../types.js';

export interface BlobParams {
  /** Square board edge length. See GenParams.gridSize. */
  readonly gridSize: number;
  readonly seed: Seed;
  /**
   * Target fraction of the grid the raw blob should occupy, before repair
   * trims it. Optional; defaults to a mid-sized blob. Clamped to a sane
   * range — near 0 produces a near-empty region and near 1 pushes the
   * boundary against the grid edge and starts to look rectangular, and
   * neither is a meaningful "organic blob" request, but both are safe
   * inputs (the repair pipeline downstream does not assume any particular
   * fraction survived).
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

// A handful of harmonics is enough to break both circular and rectangular
// symmetry without needing so many that neighbouring lobes cancel back out
// into a near-constant radius.
const MIN_HARMONICS = 3;
const MAX_HARMONICS = 6;

const MIN_AMPLITUDE_FRACTION = 0.12;
const MAX_AMPLITUDE_FRACTION = 0.4;

// However harmonics conspire, the radius never drops below this fraction of
// the base radius. Without a floor, destructive interference between
// harmonics can push the radius through zero and fold the boundary curve
// back on itself, which would fragment the blob into unrelated pieces
// instead of just carving an inlet into one organic shape.
const MIN_RADIUS_FRACTION = 0.2;

interface Harmonic {
  readonly frequency: number;
  readonly amplitudeFraction: number;
  readonly phase: number;
}

/**
 * Deterministic given `(seed, gridSize)` — same inputs, identical grid. All
 * randomness is drawn from `createRng(seed)`, never `Math.random`.
 */
export function generateBlob(params: BlobParams): Blob {
  const { gridSize } = params;
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error(`gridSize must be a positive integer, got ${gridSize}`);
  }
  // NaN would survive clamp() and poison the radius and centre, so every
  // dist <= radius test is false and even the non-empty fallback below writes
  // to inside[NaN] — a silent no-op on a Uint8Array. The result is an all-zero
  // mask, which is exactly the invariant this function promises not to break.
  if (params.fillFraction !== undefined && !Number.isFinite(params.fillFraction)) {
    throw new Error(`fillFraction must be a finite number, got ${params.fillFraction}`);
  }
  const width = gridSize;
  const height = gridSize;
  const rng = createRng(params.seed);

  // Harmonics are drawn before fillFraction ever touches a number below, so
  // that the blob's "personality" (how lobed it is, where the lobes sit)
  // depends only on the seed, and fillFraction purely rescales it. That
  // keeps area monotone in fillFraction for a fixed seed, which is what
  // makes "tunable fraction" a testable property rather than a vibe.
  const harmonicCount = MIN_HARMONICS + rng.int(MAX_HARMONICS - MIN_HARMONICS + 1);
  const harmonics: Harmonic[] = [];
  for (let k = 0; k < harmonicCount; k++) {
    harmonics.push({
      frequency: k + 2, // 2..harmonicCount+1 lobes contributed per harmonic
      // Divide by sqrt(count) so that harmonics summing in phase (rare, but
      // possible at some angle) still bound the worst-case bulge, the same
      // way independent-variance sums bound an RMS rather than a raw sum.
      amplitudeFraction:
        rng.range(MIN_AMPLITUDE_FRACTION, MAX_AMPLITUDE_FRACTION) / Math.sqrt(harmonicCount),
      phase: rng.range(0, Math.PI * 2),
    });
  }

  const fillFraction = clamp(
    params.fillFraction ?? DEFAULT_FILL_FRACTION,
    MIN_FILL_FRACTION,
    MAX_FILL_FRACTION,
  );
  // Area of a disc of this radius approximates the requested fraction of the
  // grid; the harmonics above then perturb that disc into an organic lobed
  // shape of roughly (not exactly) the same area.
  const baseRadius = Math.sqrt((fillFraction * width * height) / Math.PI);

  // Jitter the centre so the blob is not dead-centre-symmetric every seed,
  // scaled to the blob itself so it stays roughly in view of the grid.
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

  // Guarantee non-empty by construction rather than by argument: whatever
  // the harmonics did, the cell nearest the centre is always inside. This is
  // the acceptance criterion "output is always non-empty" as an invariant,
  // not a statistical likelihood.
  const centreX = clampIndex(Math.round(cx - 0.5), width);
  const centreY = clampIndex(Math.round(cy - 0.5), height);
  inside[toIndex(centreX, centreY, width)] = 1;

  return { width, height, inside };
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
