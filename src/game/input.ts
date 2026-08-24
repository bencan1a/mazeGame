/**
 * The gesture arbiter: the one place that turns a stream of pointer events
 * into a tap, a drag, or a pinch. Every pointer listener in the app attaches
 * through the handlers returned here, so a drag can never also register as a
 * tap on whatever segment it happened to end over.
 *
 * Pan and pinch math live elsewhere; this module only classifies and hands
 * off deltas and focal points through injected callbacks. `PointerEventLike`
 * matches the real shape of `PointerEvent`, so no event adapter is needed —
 * but `clientX`/`clientY` are page-relative, not the canvas-local space
 * `hitTest` expects, so a caller whose canvas is not at the page's top-left
 * corner must supply `toCssPixel` to convert.
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
  /** Movement beyond this, in CSS pixels, turns a pending tap into a drag. */
  readonly slopCssPx?: number;
  /**
   * Converts page-relative pointer coordinates into the canvas-local
   * `CssPixel` space `hitTest` reads. Defaults to the identity mapping,
   * which is only correct when the canvas's top-left corner sits at the
   * page origin — a caller with a header, a safe-area inset, or any other
   * offset must supply its own, typically subtracting a bounding-rect
   * offset that can itself change on scroll or resize.
   */
  readonly toCssPixel?: (pageX: number, pageY: number) => CssPixel;
  /**
   * A pointer with no `move` and no `up`/`cancel` for longer than this, in
   * milliseconds, is dropped the next time a different pointer goes down —
   * a lost release must not permanently misread every later single-finger
   * press as half a pinch.
   */
  readonly stalePointerMs?: number;
  /** Clock the staleness check reads. Overridable so a test can control it without a real delay. */
  readonly now?: () => number;
}

export interface GestureArbiter {
  onPointerDown: (event: PointerEventLike) => void;
  onPointerMove: (event: PointerEventLike) => void;
  onPointerUp: (event: PointerEventLike) => void;
  onPointerCancel: (event: PointerEventLike) => void;
  /** Discards every tracked pointer and returns to idle, firing whatever end callback the in-flight gesture owes. */
  reset: () => void;
}

const DEFAULT_SLOP_CSS_PX = 8;
const DEFAULT_STALE_POINTER_MS = 1500;

type Mode = 'idle' | 'pending' | 'panning' | 'pinching';

interface PointerPos {
  readonly x: number;
  readonly y: number;
  readonly lastSeenAt: number;
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

  const stalePointerMs = options?.stalePointerMs ?? DEFAULT_STALE_POINTER_MS;
  if (!Number.isFinite(stalePointerMs) || stalePointerMs <= 0) {
    throw new RangeError(`stalePointerMs must be a positive finite number, got ${stalePointerMs}`);
  }
  const now = options?.now ?? Date.now;

  const pointers = new Map<number, PointerPos>();
  let mode: Mode = 'idle';

  let primaryId: number | null = null;
  let startPos: PointerPos = { x: 0, y: 0, lastSeenAt: 0 };

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
    prevPinchDistance = distance(a, b);
    handlers.onPinchStart?.();
  }

  function endGesture(): void {
    mode = 'idle';
    primaryId = null;
    pinchIdA = null;
    pinchIdB = null;
  }

  function onPointerDown(event: PointerEventLike): void {
    if (!isFiniteEvent(event)) return;
    evictStalePointers(now());

    const pos: PointerPos = { x: event.clientX, y: event.clientY, lastSeenAt: now() };
    pointers.set(event.pointerId, pos);

    if (pointers.size === 1) {
      beginPending(event.pointerId, pos);
    } else if (pointers.size === 2) {
      if (mode === 'panning') handlers.onPanEnd?.();
      beginPinch();
    }
    // A third simultaneous pointer is tracked for release bookkeeping only;
    // the gesture in progress keeps its original two pointers.
  }

  function onPointerMove(event: PointerEventLike): void {
    const prev = pointers.get(event.pointerId);
    if (prev === undefined) return;
    if (!isFiniteEvent(event)) return;
    const pos: PointerPos = { x: event.clientX, y: event.clientY, lastSeenAt: now() };
    pointers.set(event.pointerId, pos);

    if (mode === 'pinching') {
      if (event.pointerId !== pinchIdA && event.pointerId !== pinchIdB) return;
      const a = pinchIdA === null ? undefined : pointers.get(pinchIdA);
      const b = pinchIdB === null ? undefined : pointers.get(pinchIdB);
      if (a === undefined || b === undefined) return;
      const dist = distance(a, b);
      if (prevPinchDistance > 0) {
        const scaleFactor = dist / prevPinchDistance;
        const focal = toCssPixel((a.x + b.x) / 2, (a.y + b.y) / 2);
        handlers.onPinchMove(scaleFactor, focal);
      }
      prevPinchDistance = dist;
      return;
    }

    if (event.pointerId !== primaryId) return;

    if (mode === 'pending') {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      if (dx * dx + dy * dy > slopSq) {
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
    const prevCss = toCssPixel(prev.x, prev.y);
    const curCss = toCssPixel(pos.x, pos.y);
    handlers.onPanMove(curCss.x - prevCss.x, curCss.y - prevCss.y);
  }

  function onPointerUp(event: PointerEventLike): void {
    if (!pointers.has(event.pointerId)) return;
    const wasPinchMember = event.pointerId === pinchIdA || event.pointerId === pinchIdB;
    const wasPrimary = event.pointerId === primaryId;
    pointers.delete(event.pointerId);

    if (mode === 'pinching') {
      if (!wasPinchMember) return;
      handlers.onPinchEnd?.();
      endGesture();
      // The other pointer, if still down, stays untracked as a gesture until
      // it is released and pressed again — resuming it as a pan or a tap
      // candidate here risks firing one from where the pinch happened to end.
      return;
    }

    if (!wasPrimary) return;

    if (mode === 'pending') {
      if (isFiniteEvent(event)) {
        const dx = event.clientX - startPos.x;
        const dy = event.clientY - startPos.y;
        // No move event exceeded slop, but a coalesced flick or a pointer
        // that left the element without capture can still jump straight from
        // press to a far release with nothing in between — the release point
        // itself has to clear slop, not just the moves seen along the way.
        if (dx * dx + dy * dy <= slopSq) {
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

  /**
   * Drops any pointer that has had no `down`/`move` for `stalePointerMs`,
   * through the same cleanup `onPointerCancel` already does for its role in
   * the gesture — so a leaked pointer cannot pair with a fresh single-finger
   * press and be misread as half a pinch forever.
   */
  function evictStalePointers(currentTime: number): void {
    const staleIds: number[] = [];
    for (const [id, pos] of pointers) {
      if (currentTime - pos.lastSeenAt > stalePointerMs) staleIds.push(id);
    }
    for (const id of staleIds) onPointerCancel({ pointerId: id, clientX: 0, clientY: 0 });
  }

  function reset(): void {
    if (mode === 'pinching') handlers.onPinchEnd?.();
    else if (mode === 'panning') handlers.onPanEnd?.();
    pointers.clear();
    endGesture();
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, reset };
}
