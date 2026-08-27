/**
 * The win burst: a cloud of paper flakes fired from one point, tumbling
 * under gravity and air drag until they fall off the bottom of the screen or
 * the burst runs out.
 *
 * Flake state lives in parallel typed arrays rather than objects, and every
 * launch quantity is a multiple of the shorter canvas edge, so a phone and a
 * desktop see the same burst rather than the same pixel speeds.
 *
 * Nothing here reads a clock or holds a canvas: the driver takes the same
 * scheduler and layer getters the exit animations take.
 */

import { createRng } from '../core/rng.js';
import type { SnakeOutScheduler } from './animate.js';
import { clearAnimationLayer, type AnimationLayer } from './layers.js';
import { PALETTE } from './palette.js';

/** How long the burst runs before the last flakes are cleared. */
export const CONFETTI_DURATION_MS = 2400;

/** Downward acceleration, as a multiple of the shorter canvas edge per second squared. */
const GRAVITY_SPANS_PER_S2 = 1.2;

/** What a flake's velocity is multiplied by over one second of drag. */
const DRAG_PER_SECOND = 0.06;

/** Launch speed range, as a multiple of the shorter canvas edge per second. */
const LAUNCH_SPEED_MIN = 0.6;
const LAUNCH_SPEED_MAX = 2.2;

/** Upward kick added to every launch, so the burst rises before it rains. */
const LAUNCH_LIFT = 0.9;

/** Flake width range, as a multiple of the shorter canvas edge. */
const FLAKE_WIDTH_MIN = 0.011;
const FLAKE_WIDTH_MAX = 0.023;

/** Progress at which flakes start fading; before it the burst is fully opaque. */
const FADE_START = 0.72;

/**
 * The largest step the driver integrates in one go. A frame delayed past this
 * — a slow paint, a tab coming back — advances the flakes less than the wall
 * clock rather than teleporting them across the screen.
 */
const MAX_STEP_SECONDS = 1 / 20;

export interface ConfettiField {
  readonly count: number;
  /** CSS px, in the animation layer's own coordinates. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** CSS px per second. */
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Radians, and radians per second. */
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  /** Tumble phase: drives the width squash that reads as a flake turning edge-on. */
  readonly tilt: Float32Array;
  readonly tiltSpin: Float32Array;
  readonly halfWidth: Float32Array;
  readonly halfHeight: Float32Array;
  /** Index into `PALETTE`. */
  readonly colors: Uint8Array;
  /** CSS px per second squared. */
  readonly gravity: number;
  /**
   * What a flake is culled against. Mutable because the layer under a running
   * burst can be resized: the flakes keep the speeds and sizes they launched
   * with, but the edges they are drawn up to are the canvas's current ones.
   */
  cssWidth: number;
  cssHeight: number;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** Enough flakes to read as a burst at any screen size, without paying for a thousand. */
export function recommendedConfettiCount(cssWidth: number, cssHeight: number): number {
  requirePositiveFinite(cssWidth, 'cssWidth');
  requirePositiveFinite(cssHeight, 'cssHeight');
  const fromArea = Math.round((cssWidth * cssHeight) / 3000);
  return Math.min(220, Math.max(60, fromArea));
}

export interface ConfettiFieldOptions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly seed: number;
  readonly count?: number;
  /** Where the burst is fired from. Defaults to the middle of the canvas. */
  readonly originX?: number;
  readonly originY?: number;
}

/** Builds a burst at rest on frame zero: every flake on the origin, already moving. */
export function createConfettiField(options: ConfettiFieldOptions): ConfettiField {
  const { cssWidth, cssHeight, seed } = options;
  requirePositiveFinite(cssWidth, 'cssWidth');
  requirePositiveFinite(cssHeight, 'cssHeight');
  const count = options.count ?? recommendedConfettiCount(cssWidth, cssHeight);
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${count}`);
  }
  const originX = options.originX ?? cssWidth / 2;
  const originY = options.originY ?? cssHeight / 2;
  const span = Math.min(cssWidth, cssHeight);
  const rng = createRng(seed);

  const field: ConfettiField = {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    rot: new Float32Array(count),
    spin: new Float32Array(count),
    tilt: new Float32Array(count),
    tiltSpin: new Float32Array(count),
    halfWidth: new Float32Array(count),
    halfHeight: new Float32Array(count),
    colors: new Uint8Array(count),
    gravity: span * GRAVITY_SPANS_PER_S2,
    cssWidth,
    cssHeight,
  };

  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const speed = span * rng.range(LAUNCH_SPEED_MIN, LAUNCH_SPEED_MAX);
    const width = span * rng.range(FLAKE_WIDTH_MIN, FLAKE_WIDTH_MAX);
    field.x[i] = originX;
    field.y[i] = originY;
    field.vx[i] = Math.cos(angle) * speed;
    field.vy[i] = Math.sin(angle) * speed - span * LAUNCH_LIFT;
    field.rot[i] = rng.range(0, Math.PI * 2);
    field.spin[i] = rng.range(-9, 9);
    field.tilt[i] = rng.range(0, Math.PI * 2);
    field.tiltSpin[i] = rng.range(4, 13) * (rng.chance(0.5) ? -1 : 1);
    field.halfWidth[i] = width / 2;
    field.halfHeight[i] = (width * rng.range(0.4, 0.9)) / 2;
    field.colors[i] = rng.int(PALETTE.length);
  }
  return field;
}

/** Moves the edges a running burst is drawn up to onto a resized canvas. */
export function resizeConfettiField(
  field: ConfettiField,
  cssWidth: number,
  cssHeight: number,
): void {
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight)) return;
  if (cssWidth <= 0 || cssHeight <= 0) return;
  field.cssWidth = cssWidth;
  field.cssHeight = cssHeight;
}

/**
 * Integrates one step. Drag is applied as a per-second velocity multiplier,
 * so the same elapsed time costs the same speed however it was cut into
 * frames.
 */
export function advanceConfetti(field: ConfettiField, dtSeconds: number): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
  const drag = Math.pow(DRAG_PER_SECOND, dtSeconds);
  const fall = field.gravity * dtSeconds;
  for (let i = 0; i < field.count; i++) {
    const vx = (field.vx[i] as number) * drag;
    const vy = ((field.vy[i] as number) + fall) * drag;
    field.vx[i] = vx;
    field.vy[i] = vy;
    field.x[i] = (field.x[i] as number) + vx * dtSeconds;
    field.y[i] = (field.y[i] as number) + vy * dtSeconds;
    field.rot[i] = (field.rot[i] as number) + (field.spin[i] as number) * dtSeconds;
    field.tilt[i] = (field.tilt[i] as number) + (field.tiltSpin[i] as number) * dtSeconds;
  }
}

/** How opaque the burst is at `progress`: solid, then fading to nothing at 1. */
export function confettiAlpha(progress: number): number {
  if (!Number.isFinite(progress) || progress <= FADE_START) return 1;
  if (progress >= 1) return 0;
  return (1 - progress) / (1 - FADE_START);
}

/** The subset of `CanvasRenderingContext2D` a flake is drawn with. */
export interface ConfettiContext2D {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Paints every flake still on screen. `alpha` multiplies the whole burst;
 * at 0 nothing is drawn at all.
 */
export function drawConfettiFrame(
  ctx: ConfettiContext2D,
  field: ConfettiField,
  alpha: number,
): void {
  if (!Number.isFinite(alpha) || alpha <= 0) return;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, alpha);
  for (let i = 0; i < field.count; i++) {
    const halfWidth = field.halfWidth[i] as number;
    const halfHeight = field.halfHeight[i] as number;
    const x = field.x[i] as number;
    const y = field.y[i] as number;
    // A rotated flake reaches its own half-diagonal in every direction.
    const reach = Math.hypot(halfWidth, halfHeight);
    if (x + reach < 0 || x - reach > field.cssWidth) continue;
    if (y + reach < 0 || y - reach > field.cssHeight) continue;
    // The squash is what reads as a flake turning edge-on to the viewer; the
    // floor keeps it a sliver rather than letting it vanish at the turn.
    const squash = 0.2 + 0.8 * Math.abs(Math.cos(field.tilt[i] as number));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(field.rot[i] as number);
    ctx.fillStyle = PALETTE[field.colors[i] as number] as string;
    ctx.fillRect(-halfWidth * squash, -halfHeight, halfWidth * 2 * squash, halfHeight * 2);
    ctx.restore();
  }
  ctx.globalAlpha = previousAlpha;
}

export interface ConfettiAnimationOptions {
  /**
   * The layer the burst is drawn on. Pass a getter when the layer can be
   * replaced mid-burst: a resize or an orientation change recreates the
   * canvas, and drawing into a discarded one strands the flakes.
   */
  readonly layer: AnimationLayer | (() => AnimationLayer);
  readonly scheduler: SnakeOutScheduler;
  readonly durationMs: number;
  /** Fixes which burst plays, so the same board celebrates the same way twice. */
  readonly seed: number;
  readonly count?: number;
  /** Called exactly once, when the burst ends. Never called after `cancel()`. */
  readonly onComplete?: () => void;
}

export interface ConfettiAnimation {
  /** Stops the burst and clears it without calling `onComplete`. Safe to call more than once. */
  cancel(): void;
}

/**
 * Drives one burst on `options.layer`, leaving every other layer untouched.
 * A layer that cannot be read or drawn ends the burst rather than throwing
 * out of a frame, so a caller waiting on `onComplete` always hears back.
 */
export function startConfettiAnimation(options: ConfettiAnimationOptions): ConfettiAnimation {
  const { scheduler, durationMs, seed } = options;
  requirePositiveFinite(durationMs, 'durationMs');
  const readLayer = (): AnimationLayer =>
    typeof options.layer === 'function' ? options.layer() : options.layer;

  let settled = false;
  let frameHandle: number | null = null;
  let unsubscribeVisible: (() => void) | null = null;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (frameHandle !== null) {
      scheduler.cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (unsubscribeVisible !== null) {
      unsubscribeVisible();
      unsubscribeVisible = null;
    }
    try {
      clearAnimationLayer(readLayer());
    } catch {
      // Nothing to clear if the layer is gone.
    }
  };

  const complete = (): void => {
    if (settled) return;
    finish();
    options.onComplete?.();
  };

  const guard = (body: () => void): boolean => {
    try {
      body();
      return true;
    } catch {
      return false;
    }
  };

  let field: ConfettiField | null = null;
  const built = guard(() => {
    const layer = readLayer();
    field = createConfettiField({
      cssWidth: layer.cssWidth,
      cssHeight: layer.cssHeight,
      seed,
      ...(options.count === undefined ? {} : { count: options.count }),
    });
    clearAnimationLayer(layer);
    drawConfettiFrame(layer.ctx, field, 1);
  });

  const startTime = scheduler.now();
  let lastTime = startTime;
  const elapsed = (): number => scheduler.now() - startTime;

  /** Subscribes and schedules only while still live, so teardown cannot be outrun. */
  const arm = (onFrame: () => void): void => {
    if (settled) return;
    unsubscribeVisible = scheduler.onVisible(() => {
      if (settled || elapsed() < durationMs) return;
      complete();
    });
    if (settled) {
      unsubscribeVisible();
      unsubscribeVisible = null;
      return;
    }
    frameHandle = scheduler.requestFrame(onFrame);
  };

  if (!built || field === null) {
    // Completion is deferred to a frame either way: onComplete must not run
    // before the caller holds the handle it is expected to cancel.
    arm(() => complete());
    return { cancel: finish };
  }
  const flakes: ConfettiField = field;

  const step = (): void => {
    frameHandle = null;
    if (settled) return;
    const now = scheduler.now();
    const dt = Math.min(MAX_STEP_SECONDS, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    const progress = Math.min(1, (now - startTime) / durationMs);
    if (progress >= 1) {
      complete();
      return;
    }
    advanceConfetti(flakes, dt);
    const drawn = guard(() => {
      const layer = readLayer();
      resizeConfettiField(flakes, layer.cssWidth, layer.cssHeight);
      clearAnimationLayer(layer);
      drawConfettiFrame(layer.ctx, flakes, confettiAlpha(progress));
    });
    if (!drawn) {
      complete();
      return;
    }
    frameHandle = scheduler.requestFrame(step);
  };

  arm(step);

  return { cancel: finish };
}
