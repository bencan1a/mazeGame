/**
 * The gesture arbiter: the one place that turns a stream of pointer events
 * into a tap, a drag, or a pinch. Every pointer listener in the app attaches
 * through the handlers returned here, so a drag can never also register as a
 * tap on whatever segment it happened to end over.
 *
 * Pan and pinch math live elsewhere; this module only classifies and hands
 * off deltas and focal points through injected callbacks. `PointerEventLike`
 * matches the real shape of `PointerEvent`, so no event adapter is needed —
 * but `clientX`/`clientY` are relative to the browser viewport's own
 * top-left corner, not scroll-adjusted and not the canvas-local space
 * `hitTest` expects, so a caller whose canvas element does not start at
 * that corner must supply `toCssPixel` to convert (typically by
 * subtracting a `getBoundingClientRect()` origin — adding scroll on top of
 * that would double-count an offset `clientX`/`clientY` never included).
 */

import type { CssPixel } from '../render/viewport.js';
import { cssPixel } from '../render/viewport.js';

/** The subset of `PointerEvent` this module reads. A real `PointerEvent` satisfies this as-is. */
export interface PointerEventLike {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
}

export interface GestureHandlers {
  /** A pointer that stayed within slop from press to release. */
  readonly onTap: (point: CssPixel) => void;
  readonly onPanStart?: () => void;
  /** CSS-pixel movement since the previous event for this gesture. */
  readonly onPanMove: (deltaXCssPx: number, deltaYCssPx: number) => void;
  readonly onPanEnd?: () => void;
  readonly onPinchStart?: () => void;
  /** Multiplicative distance change since the previous event, and the current midpoint of the two pointers. */
  readonly onPinchMove: (scaleFactor: number, focal: CssPixel) => void;
  readonly onPinchEnd?: () => void;
}

export interface GestureArbiterOptions {
  /** Movement beyond this, measured in CSS pixels through `toCssPixel`, turns a pending tap into a drag. */
  readonly slopCssPx?: number;
  /**
   * Converts viewport-relative pointer coordinates (`clientX`/`clientY`)
   * into the canvas-local `CssPixel` space `hitTest` reads. Defaults to the
   * identity mapping, which is only correct when the canvas's top-left
   * corner sits at the browser viewport's own origin — a caller with a
   * header, a safe-area inset, or any other offset must supply its own,
   * typically subtracting a `getBoundingClientRect()` origin, which is
   * already viewport-relative and must not have scroll added to it.
   */
  readonly toCssPixel?: (viewportX: number, viewportY: number) => CssPixel;
}

export interface GestureArbiter {
  onPointerDown: (event: PointerEventLike) => void;
  onPointerMove: (event: PointerEventLike) => void;
  onPointerUp: (event: PointerEventLike) => void;
  onPointerCancel: (event: PointerEventLike) => void;
  /**
   * Discards every tracked pointer and returns to idle, firing whatever end
   * callback the in-flight gesture owes. The only recovery from a pointer
   * whose `up`/`cancel` was lost by the platform — held motionless is not
   * itself a signal of that, so nothing here evicts on a timer.
   */
  reset: () => void;
}

const DEFAULT_SLOP_CSS_PX = 8;
const MAX_TRACKED_POINTERS = 2;

type Mode = 'idle' | 'pending' | 'panning' | 'pinching';

interface PointerPos {
  readonly x: number;
  readonly y: number;
}

function isFiniteEvent(event: PointerEventLike): boolean {
  return Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
}

function distance(a: PointerPos, b: PointerPos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * `handlers.onPanMove` and `handlers.onPinchMove` are required — a caller
 * that ignores pan or zoom would rather not be asked in the first place.
 * The `on*Start`/`on*End` pair around each is optional bookkeeping.
 */
export function createGestureArbiter(
  handlers: GestureHandlers,
  options?: GestureArbiterOptions,
): GestureArbiter {
  const slopCssPx = options?.slopCssPx ?? DEFAULT_SLOP_CSS_PX;
  if (!Number.isFinite(slopCssPx) || slopCssPx < 0) {
    throw new RangeError(`slopCssPx must be a non-negative finite number, got ${slopCssPx}`);
  }
  const slopSq = slopCssPx * slopCssPx;
  const toCssPixel = options?.toCssPixel ?? ((x: number, y: number) => cssPixel(x, y));

  const pointers = new Map<number, PointerPos>();
  let mode: Mode = 'idle';

  let primaryId: number | null = null;
  let startPos: PointerPos = { x: 0, y: 0 };

  let pinchIdA: number | null = null;
  let pinchIdB: number | null = null;
  let prevPinchDistance = 0;

  function beginPending(id: number, pos: PointerPos): void {
    mode = 'pending';
    primaryId = id;
    startPos = pos;
  }

  function beginPinch(): void {
    const ids = [...pointers.keys()];
    const idA = ids[0];
    const idB = ids[1];
    if (idA === undefined || idB === undefined) return;
    const a = pointers.get(idA);
    const b = pointers.get(idB);
    if (a === undefined || b === undefined) return;
    mode = 'pinching';
    pinchIdA = idA;
    pinchIdB = idB;
    // In CSS pixels, matching how onPointerMove measures it -- otherwise
    // the first scaleFactor mixes a CSS-space numerator with a
    // raw-coordinate baseline under a non-uniform mapper.
    prevPinchDistance = distance(toCssPixel(a.x, a.y), toCssPixel(b.x, b.y));
    handlers.onPinchStart?.();
  }

  function endGesture(): void {
    mode = 'idle';
    primaryId = null;
    pinchIdA = null;
    pinchIdB = null;
  }

  /** CSS-pixel delta between two viewport-relative points, through the injected mapper. */
  function cssDelta(fromX: number, fromY: number, toX: number, toY: number): CssPixel {
    const from = toCssPixel(fromX, fromY);
    const to = toCssPixel(toX, toY);
    return cssPixel(to.x - from.x, to.y - from.y);
  }

  function onPointerDown(event: PointerEventLike): void {
    if (!isFiniteEvent(event)) return;

    if (pointers.has(event.pointerId)) {
      // A repeat pointerdown for an id already tracked means the previous
      // session for that id ended without an up/cancel ever reaching here —
      // a dropped event with the platform recycling the id, or a handler
      // wired at two levels of a bubbling DOM path. End whatever gesture it
      // was part of properly first, exactly as a real cancel would, so a
      // live drag or pinch can never be silently swallowed into a fresh tap
      // candidate instead of firing its End callback.
      onPointerCancel(event);
    } else if (pointers.size >= MAX_TRACKED_POINTERS) {
      // A third simultaneous pointer is ignored outright rather than
      // tracked: once two pointers already define the gesture, a
      // lingering third must not be able to starve every later
      // single-finger press of ever seeing pointers.size <= 2.
      return;
    }

    const pos: PointerPos = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, pos);

    if (pointers.size === 1) {
      beginPending(event.pointerId, pos);
    } else if (pointers.size === 2) {
      if (mode === 'panning') handlers.onPanEnd?.();
      beginPinch();
    }
  }

  function onPointerMove(event: PointerEventLike): void {
    const prev = pointers.get(event.pointerId);
    if (prev === undefined) return;
    if (!isFiniteEvent(event)) return;
    const pos: PointerPos = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, pos);

    if (mode === 'pinching') {
      if (event.pointerId !== pinchIdA && event.pointerId !== pinchIdB) return;
      const a = pinchIdA === null ? undefined : pointers.get(pinchIdA);
      const b = pinchIdB === null ? undefined : pointers.get(pinchIdB);
      if (a === undefined || b === undefined) return;
      // Distance is measured in CSS pixels, like the focal point, the pan
      // delta and the slop check: a non-uniform mapper scales x and y
      // differently, so a raw-coordinate distance would report the wrong
      // ratio for a diagonal pinch.
      const dist = distance(toCssPixel(a.x, a.y), toCssPixel(b.x, b.y));
      // Guard both operands: a zero numerator is as unusable to a consumer
      // multiplying its scale by scaleFactor as a zero denominator would be
      // to divide by — either produces a scale of exactly 0, which
      // createViewport rejects, so the frame is skipped rather than handed
      // out as a scale factor no caller can recover from.
      if (prevPinchDistance > 0 && dist > 0) {
        const scaleFactor = dist / prevPinchDistance;
        const focal = toCssPixel((a.x + b.x) / 2, (a.y + b.y) / 2);
        handlers.onPinchMove(scaleFactor, focal);
      }
      prevPinchDistance = dist;
      return;
    }

    if (event.pointerId !== primaryId) return;

    if (mode === 'pending') {
      const delta = cssDelta(startPos.x, startPos.y, pos.x, pos.y);
      if (delta.x * delta.x + delta.y * delta.y > slopSq) {
        mode = 'panning';
        handlers.onPanStart?.();
        emitPanMove(prev, pos);
      }
      return;
    }

    if (mode === 'panning') {
      emitPanMove(prev, pos);
    }
  }

  function emitPanMove(prev: PointerPos, pos: PointerPos): void {
    const delta = cssDelta(prev.x, prev.y, pos.x, pos.y);
    handlers.onPanMove(delta.x, delta.y);
  }

  function onPointerUp(event: PointerEventLike): void {
    if (!pointers.has(event.pointerId)) return;
    const wasPinchMember = event.pointerId === pinchIdA || event.pointerId === pinchIdB;
    const wasPrimary = event.pointerId === primaryId;
    pointers.delete(event.pointerId);

    if (mode === 'pinching') {
      if (!wasPinchMember) return;
      const otherId = event.pointerId === pinchIdA ? pinchIdB : pinchIdA;
      handlers.onPinchEnd?.();
      endGesture();

      // The other pointer, if still down, resumes as a pan from here rather
      // than going idle: the gesture is already well past slop and this
      // pointer has an established position to continue from, so there is
      // no spurious-tap risk the way there would be for a fresh press.
      // Lifting one finger of a two-finger gesture and continuing to drag
      // with the other is an ordinary phone gesture.
      const otherPos = otherId === null ? undefined : pointers.get(otherId);
      if (otherId !== null && otherPos !== undefined) {
        mode = 'panning';
        primaryId = otherId;
        startPos = otherPos;
        handlers.onPanStart?.();
      }
      return;
    }

    if (!wasPrimary) return;

    if (mode === 'pending') {
      if (isFiniteEvent(event)) {
        // No move event exceeded slop, but a coalesced flick or a pointer
        // that left the element without capture can still jump straight from
        // press to a far release with nothing in between — the release point
        // itself has to clear slop, not just the moves seen along the way.
        const delta = cssDelta(startPos.x, startPos.y, event.clientX, event.clientY);
        if (delta.x * delta.x + delta.y * delta.y <= slopSq) {
          handlers.onTap(toCssPixel(event.clientX, event.clientY));
        }
      }
      endGesture();
      return;
    }

    if (mode === 'panning') {
      handlers.onPanEnd?.();
      endGesture();
    }
  }

  function onPointerCancel(event: PointerEventLike): void {
    if (!pointers.has(event.pointerId)) return;
    const wasPinchMember = event.pointerId === pinchIdA || event.pointerId === pinchIdB;
    const wasPrimary = event.pointerId === primaryId;
    pointers.delete(event.pointerId);

    if (mode === 'pinching' && wasPinchMember) {
      handlers.onPinchEnd?.();
      endGesture();
      return;
    }
    if (mode === 'panning' && wasPrimary) {
      handlers.onPanEnd?.();
      endGesture();
      return;
    }
    if (mode === 'pending' && wasPrimary) {
      endGesture();
    }
  }

  function reset(): void {
    if (mode === 'pinching') handlers.onPinchEnd?.();
    else if (mode === 'panning') handlers.onPanEnd?.();
    pointers.clear();
    endGesture();
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, reset };
}
