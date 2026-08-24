import { describe, expect, it } from 'vitest';
import { cssPixel } from '../render/viewport.js';
import type { CssPixel } from '../render/viewport.js';
import { createGestureArbiter } from './input.js';
import type { GestureHandlers, PointerEventLike } from './input.js';

function pointerEvent(pointerId: number, x: number, y: number): PointerEventLike {
  return { pointerId, clientX: x, clientY: y };
}

function makeHandlers(): GestureHandlers & {
  readonly calls: {
    tap: CssPixel[];
    panStart: number;
    panMove: [number, number][];
    panEnd: number;
    pinchStart: number;
    pinchMove: [number, CssPixel][];
    pinchEnd: number;
  };
} {
  const calls = {
    tap: [] as CssPixel[],
    panStart: 0,
    panMove: [] as [number, number][],
    panEnd: 0,
    pinchStart: 0,
    pinchMove: [] as [number, CssPixel][],
    pinchEnd: 0,
  };
  return {
    calls,
    onTap: (point) => calls.tap.push(point),
    onPanStart: () => {
      calls.panStart++;
    },
    onPanMove: (dx, dy) => calls.panMove.push([dx, dy]),
    onPanEnd: () => {
      calls.panEnd++;
    },
    onPinchStart: () => {
      calls.pinchStart++;
    },
    onPinchMove: (scaleFactor, focal) => calls.pinchMove.push([scaleFactor, focal]),
    onPinchEnd: () => {
      calls.pinchEnd++;
    },
  };
}

describe('createGestureArbiter: tap', () => {
  it('fires onTap for a pointer that stays within slop and releases', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 10, 10));
    arbiter.onPointerMove(pointerEvent(1, 12, 11));
    arbiter.onPointerUp(pointerEvent(1, 12, 11));

    expect(handlers.calls.tap).toEqual([cssPixel(12, 11)]);
    expect(handlers.calls.panStart).toBe(0);
    expect(handlers.calls.panMove).toEqual([]);
  });

  it('fires onTap immediately on down+up with no move in between', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 5, 5));
    arbiter.onPointerUp(pointerEvent(1, 5, 5));

    expect(handlers.calls.tap).toEqual([cssPixel(5, 5)]);
  });

  it('does not fire onTap for a pointer released mid-pinch', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    arbiter.onPointerUp(pointerEvent(1, 0, 0));
    arbiter.onPointerUp(pointerEvent(2, 100, 0));

    expect(handlers.calls.tap).toEqual([]);
  });
});

describe('createGestureArbiter: pan', () => {
  it('a drag past the slop threshold never produces a tap', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 8 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 20, 0));
    arbiter.onPointerUp(pointerEvent(1, 20, 0));

    expect(handlers.calls.tap).toEqual([]);
    expect(handlers.calls.panStart).toBe(1);
    expect(handlers.calls.panEnd).toBe(1);
  });

  it('reports incremental CSS-pixel deltas, not cumulative ones', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 5 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 10, 0)); // exceeds slop, starts the drag
    arbiter.onPointerMove(pointerEvent(1, 15, 4));
    arbiter.onPointerUp(pointerEvent(1, 15, 4));

    expect(handlers.calls.panMove).toEqual([
      [10, 0],
      [5, 4],
    ]);
  });

  it('stays a tap at exactly the slop distance, and a drag just past it', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 10 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 10, 0));
    arbiter.onPointerUp(pointerEvent(1, 10, 0));
    expect(handlers.calls.tap).toEqual([cssPixel(10, 0)]);

    const handlers2 = makeHandlers();
    const arbiter2 = createGestureArbiter(handlers2, { slopCssPx: 10 });
    arbiter2.onPointerDown(pointerEvent(1, 0, 0));
    arbiter2.onPointerMove(pointerEvent(1, 10.1, 0));
    arbiter2.onPointerUp(pointerEvent(1, 10.1, 0));
    expect(handlers2.calls.tap).toEqual([]);
    expect(handlers2.calls.panStart).toBe(1);
  });

  it('a cancelled drag ends the pan without a tap', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 5 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 50, 0));
    arbiter.onPointerCancel(pointerEvent(1, 50, 0));

    expect(handlers.calls.tap).toEqual([]);
    expect(handlers.calls.panEnd).toBe(1);
  });

  it('a cancelled pending pointer never fires a tap', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerCancel(pointerEvent(1, 0, 0));

    expect(handlers.calls.tap).toEqual([]);
  });
});

describe('createGestureArbiter: pinch', () => {
  it('starts a pinch on the second pointer and reports scale factor and focal point', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    expect(handlers.calls.pinchStart).toBe(1);

    arbiter.onPointerMove(pointerEvent(2, 200, 0)); // distance 100 -> 200
    expect(handlers.calls.pinchMove).toEqual([[2, cssPixel(100, 0)]]);

    arbiter.onPointerUp(pointerEvent(1, 0, 0));
    arbiter.onPointerUp(pointerEvent(2, 200, 0));
    expect(handlers.calls.pinchEnd).toBe(1);
  });

  it('ends an in-progress pan before starting a pinch', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 1 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 20, 0));
    expect(handlers.calls.panStart).toBe(1);

    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    expect(handlers.calls.panEnd).toBe(1);
    expect(handlers.calls.pinchStart).toBe(1);
  });

  it('does not resume the leftover pointer as a tap or drag candidate once a pinch ends', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    arbiter.onPointerUp(pointerEvent(1, 0, 0));
    expect(handlers.calls.pinchEnd).toBe(1);
    expect(handlers.calls.panStart).toBe(0);

    arbiter.onPointerMove(pointerEvent(2, 100, 40));
    arbiter.onPointerUp(pointerEvent(2, 100, 40));
    expect(handlers.calls.tap).toEqual([]);
    expect(handlers.calls.panStart).toBe(0);

    // A fresh press on the same pointer id starts a normal tap candidate again.
    arbiter.onPointerDown(pointerEvent(2, 5, 5));
    arbiter.onPointerUp(pointerEvent(2, 5, 5));
    expect(handlers.calls.tap).toEqual([cssPixel(5, 5)]);
  });

  it('a cancelled pinch pointer ends the pinch without a tap', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    arbiter.onPointerCancel(pointerEvent(1, 0, 0));

    expect(handlers.calls.pinchEnd).toBe(1);
    expect(handlers.calls.tap).toEqual([]);
  });
});

describe('createGestureArbiter: toCssPixel', () => {
  it('defaults to page coordinates unchanged', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 40, 60));
    arbiter.onPointerUp(pointerEvent(1, 40, 60));

    expect(handlers.calls.tap).toEqual([cssPixel(40, 60)]);
  });

  it('converts page-relative pointer coordinates into canvas-local ones for a tap', () => {
    const handlers = makeHandlers();
    // A canvas offset 20px right and 30px down from the page origin.
    const toCssPixel = (pageX: number, pageY: number) => cssPixel(pageX - 20, pageY - 30);
    const arbiter = createGestureArbiter(handlers, { toCssPixel });

    arbiter.onPointerDown(pointerEvent(1, 40, 60));
    arbiter.onPointerUp(pointerEvent(1, 40, 60));

    expect(handlers.calls.tap).toEqual([cssPixel(20, 30)]);
  });

  it('applies the same conversion to a pinch focal point', () => {
    const handlers = makeHandlers();
    const toCssPixel = (pageX: number, pageY: number) => cssPixel(pageX - 20, pageY - 30);
    const arbiter = createGestureArbiter(handlers, { toCssPixel });

    arbiter.onPointerDown(pointerEvent(1, 20, 30));
    arbiter.onPointerDown(pointerEvent(2, 120, 30));
    arbiter.onPointerMove(pointerEvent(2, 220, 30));

    // Page-space midpoint after the move is (120, 30); toCssPixel subtracts (20, 30).
    expect(handlers.calls.pinchMove).toEqual([[2, cssPixel(100, 0)]]);
  });
});

describe('createGestureArbiter: malformed input', () => {
  it('ignores a pointer event with non-finite coordinates', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, NaN, 10));
    arbiter.onPointerUp(pointerEvent(1, 10, 10));

    expect(handlers.calls.tap).toEqual([]);
  });

  it('does not fire onTap when the releasing event itself is non-finite', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 10, 10));
    arbiter.onPointerUp(pointerEvent(1, NaN, 10));

    expect(handlers.calls.tap).toEqual([]);
  });

  it.each([NaN, -1, -Infinity])('rejects an invalid slopCssPx of %p', (bad) => {
    expect(() => createGestureArbiter(makeHandlers(), { slopCssPx: bad })).toThrow(RangeError);
  });
});

describe('createGestureArbiter: untracked pointers', () => {
  it('ignores move/up/cancel for a pointerId that never went down', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerMove(pointerEvent(99, 5, 5));
    arbiter.onPointerUp(pointerEvent(99, 5, 5));
    arbiter.onPointerCancel(pointerEvent(99, 5, 5));

    expect(handlers.calls.tap).toEqual([]);
    expect(handlers.calls.panMove).toEqual([]);
  });
});
