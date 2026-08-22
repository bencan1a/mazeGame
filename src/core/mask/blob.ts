/**
 * Procedural blob generator (S1, issue #2; half-resolution rework, issue #58).
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
 * sinusoidal harmonics. Their frequencies are fixed (2, 3, 4, ... one per
 * harmonic); the seed chooses how many there are and randomises each one's
 * phase and amplitude. That is enough to produce lobes and concavities, so the
 * result is neither a disc (constant radius) nor a rectangle (axis-aligned
 * boundary) for any seed — see blob.test.ts for the property tests that pin
 * this down.
 *
 * Half-resolution generation (#58): the spanning-tree contour path method
 * (#5) is the PRD's primary path-fill method, but it only runs on regions
 * that tile into 2x2 blocks at full resolution — and an arbitrary organic
 * boundary drawn directly at full resolution essentially never does (measured
 * 0/300 on the previous full-resolution generator; see the issue for the
 * sweep). So this generator draws the radial silhouette on a
 * `halfWidth x halfHeight` lattice — half the edge length, rounded down — and
 * then upscales every half-resolution cell into a 2x2 block of full-
 * resolution cells. Every region this produces is therefore block-aligned to
 * offset (0, 0) *by construction*, not by getting lucky with an organic
 * boundary. The trade is real and accepted: outlines are pixelated at 2-cell
 * resolution rather than 1-cell. The organic lobing itself (the harmonics)
 * is untouched — it happens on the half-resolution lattice exactly as it used
 * to happen on the full one — so the silhouette is coarser in outline detail,
 * not simpler in overall shape.
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
 * Half of `gridSize`, rounded down, floored to 1. Odd `gridSize` is handled
 * explicitly by rounding down rather than rejecting: the PRD's grid-size
 * range (20..100, ADR-0006) does not promise even numbers, and there is
 * nothing wrong with an odd full-resolution grid — it just means one row and
 * one column of full-resolution cells (the ones at index `2 * halfSize` and
 * beyond) sit outside the half-resolution lattice entirely, and so must never
 * be inside the silhouette. `upscale2x` enforces exactly that: it never
 * writes past `2 * halfSize` in either axis, so that leftover strip stays
 * zeroed (outside) by construction. The floor of 1 covers the degenerate
 * `gridSize` 0/1 case a couple of existing corner-case tests still exercise;
 * a `gridSize` that small has no meaningful "half resolution", but it must
 * still come back non-empty rather than throw.
 */
function halfResSize(gridSize: number): number {
  return Math.max(1, Math.floor(gridSize / 2));
}

/**
 * Deterministic given `(seed, gridSize, fillFraction)` — same inputs, identical
 * grid. All randomness is drawn from `createRng(seed)`, never `Math.random`.
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
  const fillFraction = clamp(
    params.fillFraction ?? DEFAULT_FILL_FRACTION,
    MIN_FILL_FRACTION,
    MAX_FILL_FRACTION,
  );

  const rng = createRng(params.seed);
  const halfSize = halfResSize(gridSize);
  // The whole shape — harmonics, jitter, radius — is decided once on the
  // half-resolution lattice. Nothing below this point draws at full
  // resolution; upscale2x is a pure remap of already-decided cells, so the
  // full-resolution boundary is always an exact 2x2-block staircase of the
  // half-resolution one, never an independent full-resolution decision that
  // could fall off the lattice.
  const half = generateRadialBlob(halfSize, halfSize, rng, fillFraction);
  return upscale2x(half, gridSize, gridSize);
}

/**
 * Draws the harmonics-perturbed radial silhouette directly on a
 * `width x height` lattice. Factored out of `generateBlob` so the lattice it
 * draws on is a parameter rather than baked in — `generateBlob` always calls
 * it at half resolution (#58), but a future mask-repair pass (#3) can call it,
 * or feed a `Blob` from elsewhere, at that same half resolution too.
 * Repairing before the 2x upscale is the intended order: erosion/dilation on
 * an already-upscaled region can shave a single full-resolution cell off a
 * 2x2 block and break the alignment `upscale2x` guarantees, whereas repairing
 * at half resolution and re-upscaling afterwards cannot — every operation
 * stays in whole-block units — and it is cheaper, since it walks a quarter as
 * many cells. This function does not enforce that ordering itself, since #3
 * does not exist yet; it just avoids foreclosing it.
 */
function generateRadialBlob(width: number, height: number, rng: Rng, fillFraction: number): Blob {
  // Harmonics are drawn before fillFraction is read, so the blob's
  // "personality" — how many lobes, where they sit, how deep — depends only on
  // the seed. fillFraction then scales the shape. Not purely, though: the
  // centre jitter below is a fraction of baseRadius, so raising fillFraction
  // also moves the centre slightly. Area is monotone in fillFraction across
  // the tested range rather than by construction, and blob.test.ts asserts it
  // rather than assuming it.
  const harmonicCount = MIN_HARMONICS + rng.int(MAX_HARMONICS - MIN_HARMONICS + 1);
  const harmonics: Harmonic[] = [];
  for (let k = 0; k < harmonicCount; k++) {
    harmonics.push({
      // Fixed, not random: one harmonic per lobe count from 2 upward, so the
      // set of frequencies is the same every seed and only their phases and
      // amplitudes vary. Random frequencies would let two harmonics land close
      // together and beat, flattening the boundary instead of lobing it.
      frequency: k + 2,
      // Divide by sqrt(count) so that harmonics summing in phase (rare, but
      // possible at some angle) still bound the worst-case bulge, the same
      // way independent-variance sums bound an RMS rather than a raw sum.
      amplitudeFraction:
        rng.range(MIN_AMPLITUDE_FRACTION, MAX_AMPLITUDE_FRACTION) / Math.sqrt(harmonicCount),
      phase: rng.range(0, Math.PI * 2),
    });
  }

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
  // not a statistical likelihood. Forcing it here, at whatever resolution
  // this function is called at, means generateBlob's own non-empty guarantee
  // falls out for free after upscaling — a forced-inside half-resolution cell
  // upscales to a forced-inside full-resolution 2x2 block.
  const centreX = clampIndex(Math.round(cx - 0.5), width);
  const centreY = clampIndex(Math.round(cy - 0.5), height);
  inside[toIndex(centreX, centreY, width)] = 1;

  return { width, height, inside };
}

/**
 * Maps every `half` cell to the 2x2 block of full-resolution cells at
 * `(2*hx, 2*hy)`. This is what makes the output block-aligned to lattice
 * offset (0, 0) unconditionally: `classifyTiling` (src/core/path/tiling.ts)
 * needs *some* offset to work, and this generator simply never produces
 * anything else, so it always finds one on the first try.
 *
 * `fullWidth`/`fullHeight` may exceed `2 * half.width` / `2 * half.height`
 * when `gridSize` is odd (`halfResSize` rounds down) — the leftover
 * full-resolution row/column past `2 * half.width` (or `.height`) is left as
 * "outside" (the array already starts zeroed), never written "inside", so it
 * can never become a path cell that no 2x2 block covers.
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
