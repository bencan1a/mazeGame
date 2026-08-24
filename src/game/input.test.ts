import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
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

  it('does not fire onTap for a release far past slop with no move event in between', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 8 });

    // A coalesced flick, or a pointer that leaves the element without
    // capture, can jump straight from press to a far release with no
    // intervening move — the release point itself must still clear slop.
    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerUp(pointerEvent(1, 60, 0));

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

  it('never emits a scaleFactor of 0 when the pinch distance briefly hits zero', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0)); // distance 100

    arbiter.onPointerMove(pointerEvent(2, 0, 0)); // distance 0 -- coincides with pointer 1
    expect(handlers.calls.pinchMove).toEqual([]);

    arbiter.onPointerMove(pointerEvent(2, 50, 0)); // distance 50, but the prior frame was 0
    expect(handlers.calls.pinchMove).toEqual([]);

    arbiter.onPointerMove(pointerEvent(2, 150, 0)); // distance 150, recovered
    expect(handlers.calls.pinchMove).toEqual([[3, cssPixel(75, 0)]]);
    expect(handlers.calls.pinchMove.some(([scaleFactor]) => scaleFactor === 0)).toBe(false);
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

  it('resumes the leftover pointer as a pan once one pinch finger lifts, rather than freezing it', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    arbiter.onPointerUp(pointerEvent(1, 0, 0));
    expect(handlers.calls.pinchEnd).toBe(1);
    // The pan resumes immediately from pointer 2's current position -- no
    // slop check, since the gesture is already well past it.
    expect(handlers.calls.panStart).toBe(1);

    arbiter.onPointerMove(pointerEvent(2, 300, 0)); // a 200px drag continues from here
    expect(handlers.calls.panMove).toEqual([[200, 0]]);

    arbiter.onPointerUp(pointerEvent(2, 300, 0));
    expect(handlers.calls.panEnd).toBe(1);
    expect(handlers.calls.tap).toEqual([]);
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

  it('scales a pan delta the same way it scales a tap or focal point', () => {
    const handlers = makeHandlers();
    // A mapper that is not a pure translation: 2x horizontally, 3x vertically.
    const toCssPixel = (pageX: number, pageY: number) => cssPixel(pageX * 2, pageY * 3);
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 5, toCssPixel });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 10, 4)); // page-space delta (10, 4), exceeds slop

    expect(handlers.calls.panMove).toEqual([[20, 12]]);
  });

  it('measures the move-time slop check in CSS pixels, not raw page pixels', () => {
    const handlers = makeHandlers();
    // 8 CSS-px slop is only 4 page px wide under this 2x mapper.
    const toCssPixel = (pageX: number, pageY: number) => cssPixel(pageX * 2, pageY);
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 8, toCssPixel });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 3, 0)); // 6 CSS px from the down point — stays pending
    expect(handlers.calls.panStart).toBe(0);

    arbiter.onPointerMove(pointerEvent(1, 5, 0)); // 10 CSS px from the down point — now a drag
    expect(handlers.calls.panStart).toBe(1);
  });

  it('measures the release-time slop check in CSS pixels, not raw page pixels', () => {
    const toCssPixel = (pageX: number, pageY: number) => cssPixel(pageX * 2, pageY);

    const withinSlop = makeHandlers();
    const a1 = createGestureArbiter(withinSlop, { slopCssPx: 8, toCssPixel });
    a1.onPointerDown(pointerEvent(1, 0, 0));
    a1.onPointerUp(pointerEvent(1, 3, 0)); // 6 CSS px, no move event at all
    expect(withinSlop.calls.tap).toEqual([cssPixel(6, 0)]);

    const pastSlop = makeHandlers();
    const a2 = createGestureArbiter(pastSlop, { slopCssPx: 8, toCssPixel });
    a2.onPointerDown(pointerEvent(1, 0, 0));
    a2.onPointerUp(pointerEvent(1, 5, 0)); // 10 CSS px
    expect(pastSlop.calls.tap).toEqual([]);
  });
});

describe('createGestureArbiter: a held-still pointer stays live', () => {
  it('starts a pinch when a second finger presses after the first has held perfectly still', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    // No pointermove for pointer 1 at all — holding still is not staleness,
    // and nothing here evicts a pointer on a timer.
    arbiter.onPointerDown(pointerEvent(2, 100, 0));

    expect(handlers.calls.pinchStart).toBe(1);
  });

  it('starts a pinch from a paused pan rather than getting stuck as a lone drag', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 5 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 50, 0)); // exceeds slop: pan starts and moves once
    // Pointer 1 then pauses with no further moves before pointer 2 arrives.
    arbiter.onPointerDown(pointerEvent(2, 100, 0));

    expect(handlers.calls.panStart).toBe(1);
    expect(handlers.calls.panMove.length).toBe(1);
    expect(handlers.calls.panEnd).toBe(1);
    expect(handlers.calls.pinchStart).toBe(1);
  });
});

describe('createGestureArbiter: a third simultaneous pointer', () => {
  it('is ignored outright, and never permanently blocks a later tap', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    expect(handlers.calls.pinchStart).toBe(1);

    arbiter.onPointerDown(pointerEvent(3, 200, 0)); // a third finger touches down mid-pinch
    arbiter.onPointerUp(pointerEvent(1, 0, 0));
    expect(handlers.calls.pinchEnd).toBe(1);

    arbiter.onPointerUp(pointerEvent(2, 100, 0));
    arbiter.onPointerUp(pointerEvent(3, 200, 0)); // never tracked, so this is a no-op

    arbiter.onPointerDown(pointerEvent(4, 5, 5));
    arbiter.onPointerUp(pointerEvent(4, 5, 5));
    expect(handlers.calls.tap).toEqual([cssPixel(5, 5)]);
  });
});

describe('createGestureArbiter: a repeat pointerdown for an already-tracked id', () => {
  it('ends an in-progress pan before starting fresh, instead of registering the drag as a tap', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 5 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 50, 0)); // exceeds slop: pan starts
    expect(handlers.calls.panStart).toBe(1);

    // The platform drops pointer 1's pointerup and later recycles its id,
    // or a handler wired at two DOM levels delivers a second down for it.
    arbiter.onPointerDown(pointerEvent(1, 50, 0));

    expect(handlers.calls.panEnd).toBe(1);
    expect(handlers.calls.tap).toEqual([]);
  });

  it('ends an in-progress pinch cleanly, rather than doubling pinchStart without a matching pinchEnd', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    expect(handlers.calls.pinchStart).toBe(1);

    arbiter.onPointerDown(pointerEvent(2, 100, 0)); // pointer 2's down repeats

    expect(handlers.calls.pinchEnd).toBe(1);
    // A fresh pinch immediately re-forms from the leftover pointer 1 and
    // the re-pressed pointer 2, matching the established leftover-pairing
    // behaviour for any new pointerdown while one pointer is still held.
    expect(handlers.calls.pinchStart).toBe(2);
  });

  it('never leaves onPanStart or onPinchStart more than one call ahead of its End, over fuzzed event sequences', () => {
    const opArb = fc.record({
      kind: fc.constantFrom('down', 'move', 'up', 'cancel', 'reset'),
      pointerId: fc.constantFrom(1, 2, 3),
      x: fc.integer({ min: -50, max: 50 }),
      y: fc.integer({ min: -50, max: 50 }),
    });

    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const handlers = makeHandlers();
        const arbiter = createGestureArbiter(handlers, { slopCssPx: 4 });

        for (const op of ops) {
          const event = pointerEvent(op.pointerId, op.x, op.y);
          if (op.kind === 'down') arbiter.onPointerDown(event);
          else if (op.kind === 'move') arbiter.onPointerMove(event);
          else if (op.kind === 'up') arbiter.onPointerUp(event);
          else if (op.kind === 'cancel') arbiter.onPointerCancel(event);
          else arbiter.reset();

          const panBalance = handlers.calls.panStart - handlers.calls.panEnd;
          const pinchBalance = handlers.calls.pinchStart - handlers.calls.pinchEnd;
          expect(panBalance).toBeGreaterThanOrEqual(0);
          expect(panBalance).toBeLessThanOrEqual(1);
          expect(pinchBalance).toBeGreaterThanOrEqual(0);
          expect(pinchBalance).toBeLessThanOrEqual(1);
          expect(panBalance === 1 && pinchBalance === 1).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('createGestureArbiter: reset', () => {
  it('recovers immediately from a stuck pinch without waiting for the stale window', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerDown(pointerEvent(2, 100, 0));
    expect(handlers.calls.pinchStart).toBe(1);

    arbiter.reset();
    expect(handlers.calls.pinchEnd).toBe(1);

    arbiter.onPointerDown(pointerEvent(3, 5, 5));
    arbiter.onPointerUp(pointerEvent(3, 5, 5));
    expect(handlers.calls.tap).toEqual([cssPixel(5, 5)]);
  });

  it('fires onPanEnd, not onPinchEnd, when resetting mid-drag', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers, { slopCssPx: 5 });

    arbiter.onPointerDown(pointerEvent(1, 0, 0));
    arbiter.onPointerMove(pointerEvent(1, 50, 0));
    expect(handlers.calls.panStart).toBe(1);

    arbiter.reset();

    expect(handlers.calls.panEnd).toBe(1);
    expect(handlers.calls.pinchEnd).toBe(0);
  });

  it('is a no-op when idle', () => {
    const handlers = makeHandlers();
    const arbiter = createGestureArbiter(handlers);

    arbiter.reset();

    expect(handlers.calls.panEnd).toBe(0);
    expect(handlers.calls.pinchEnd).toBe(0);
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
