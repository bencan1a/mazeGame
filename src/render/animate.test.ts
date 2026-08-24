import { describe, expect, it } from 'vitest';
import {
  buildExitPath,
  drawSnakeOutFrame,
  startSnakeOutAnimation,
  type SnakeOutScheduler,
} from './animate.js';
import { createAnimationLayer, redrawStaticLayer, type CanvasLike } from './layers.js';
import { createBufferViewport, createViewport } from './viewport.js';
import { ACYCLIC_BOARD, makeBoard } from '../../test/fixtures/board.js';
import type { AnimationLayer, StaticLayer } from './layers.js';

type Call =
  | { op: 'beginPath' }
  | { op: 'moveTo'; x: number; y: number }
  | { op: 'lineTo'; x: number; y: number }
  | { op: 'stroke'; dash: readonly number[]; offset: number; color: string; width: number }
  | { op: 'closePath' }
  | { op: 'fill'; color: string }
  | { op: 'setLineDash'; segments: readonly number[] }
  | { op: 'clearRect'; x: number; y: number; w: number; h: number }
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'setTransform' }
  | { op: 'scale' };

class FakeCtx {
  readonly calls: Call[] = [];
  strokeStyle = '';
  fillStyle = '';
  lineWidth = 0;
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';
  lineDashOffset = 0;
  private dash: number[] = [];

  beginPath(): void {
    this.calls.push({ op: 'beginPath' });
  }
  moveTo(x: number, y: number): void {
    this.calls.push({ op: 'moveTo', x, y });
  }
  lineTo(x: number, y: number): void {
    this.calls.push({ op: 'lineTo', x, y });
  }
  stroke(): void {
    this.calls.push({
      op: 'stroke',
      dash: [...this.dash],
      offset: this.lineDashOffset,
      color: this.strokeStyle,
      width: this.lineWidth,
    });
  }
  closePath(): void {
    this.calls.push({ op: 'closePath' });
  }
  fill(): void {
    this.calls.push({ op: 'fill', color: this.fillStyle });
  }
  setLineDash(segments: readonly number[]): void {
    this.dash = [...segments];
    this.calls.push({ op: 'setLineDash', segments: [...segments] });
  }
  getLineDash(): number[] {
    return [...this.dash];
  }
  save(): void {
    this.calls.push({ op: 'save' });
  }
  restore(): void {
    this.calls.push({ op: 'restore' });
  }
  setTransform(): void {
    this.calls.push({ op: 'setTransform' });
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: 'clearRect', x, y, w, h });
  }
  scale(): void {
    this.calls.push({ op: 'scale' });
  }
}

function fakeAnimationLayer(
  cssWidth = 100,
  cssHeight = 100,
  dpr = 1,
): { layer: AnimationLayer; ctx: FakeCtx } {
  let ctx: FakeCtx | undefined;
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext(id: '2d') {
      if (id !== '2d') return null;
      ctx = new FakeCtx();
      return ctx as unknown as CanvasRenderingContext2D;
    },
  };
  const layer = createAnimationLayer(cssWidth, cssHeight, dpr, () => canvas);
  return { layer, ctx: ctx as FakeCtx };
}

/** A single-frame, single-subscriber fake scheduler: `now` and the queued frame/visibility callbacks are all driven by the test. */
function fakeScheduler(): SnakeOutScheduler & {
  clock: { value: number };
  frames: Map<number, (time: number) => void>;
  visibleSubscribers: Set<() => void>;
  fireVisible(): void;
} {
  let nextId = 1;
  const frames = new Map<number, (time: number) => void>();
  const visibleSubscribers = new Set<() => void>();
  const clock = { value: 0 };
  return {
    clock,
    frames,
    visibleSubscribers,
    now() {
      return clock.value;
    },
    requestFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    onVisible(callback) {
      visibleSubscribers.add(callback);
      return () => visibleSubscribers.delete(callback);
    },
    fireVisible() {
      for (const cb of [...visibleSubscribers]) cb();
    },
  };
}

/** Runs whichever frame callbacks are currently queued, in id order, leaving newly-scheduled ones for the next call. */
function runQueuedFrames(scheduler: ReturnType<typeof fakeScheduler>, time: number): void {
  const due = [...scheduler.frames.entries()].sort((a, b) => a[0] - b[0]);
  for (const [id, callback] of due) {
    scheduler.frames.delete(id);
    callback(time);
  }
}

describe('buildExitPath', () => {
  const viewport = createViewport({ scale: 10 });

  it('orders vertices polyline-then-ray-then-edge, tail to head to the board edge', () => {
    // ACYCLIC_BOARD segment 1 ("a"): (0,0)->(1,0)->(2,0)->(3,0)->head(3,1), exit south on a 4x4 board.
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    expect(Array.from(path.xs)).toEqual([5, 15, 25, 35, 35, 35, 35, 35]);
    expect(Array.from(path.ys)).toEqual([5, 5, 5, 5, 15, 25, 35, 40]);
    expect(Array.from(path.edgeDirs)).toEqual([1, 1, 1, 2, 2, 2, 2]); // E,E,E,S,S,S,S
    expect(path.dashLength).toBe(40); // 4 polyline edges * scale 10
    expect(path.totalLength).toBe(65); // 6 full edges * 10 + the final half-cell edge
  });

  it('is dashLength 0 for a one-cell segment, with a ray-only path', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'E' } });
    const path = buildExitPath(board, 1, viewport);
    expect(Array.from(path.xs)).toEqual([5, 10]);
    expect(Array.from(path.ys)).toEqual([5, 5]);
    expect(path.dashLength).toBe(0);
    expect(path.totalLength).toBe(5); // half a cell, immediate exit
  });

  it('steps the ray north, away from the head, toward the top edge', () => {
    const board = makeBoard({ art: ['...', '...', '.A.'].join('\n'), dirs: { a: 'N' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2); // one cell + 2 ray steps + the edge point
    expect(path.totalLength).toBeCloseTo(2 * 10 + 5, 6);
  });

  it('steps the ray south, toward the bottom edge', () => {
    const board = makeBoard({ art: ['.A.', '...', '...'].join('\n'), dirs: { a: 'S' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(2 * 10 + 5, 6);
  });

  it('steps the ray east, toward the right edge', () => {
    const board = makeBoard({ art: ['A..', '...', '...'].join('\n'), dirs: { a: 'E' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(2 * 10 + 5, 6);
  });

  it('steps the ray west, toward the left edge', () => {
    const board = makeBoard({ art: ['..A', '...', '...'].join('\n'), dirs: { a: 'W' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(2 * 10 + 5, 6);
  });

  it('exits immediately when the head already sits on the top board edge', () => {
    const path = buildExitPath(makeBoard(['A', 'a'].join('\n')), 1, viewport);
    expect(path.xs.length).toBe(3); // 2-cell polyline + the edge point, zero ray steps
    expect(path.totalLength).toBeCloseTo(10 + 5, 6);
  });

  it('exits immediately when the head already sits on the bottom board edge', () => {
    const path = buildExitPath(makeBoard(['a', 'A'].join('\n')), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(10 + 5, 6);
  });

  it('exits immediately when the head already sits on the right board edge', () => {
    const path = buildExitPath(makeBoard('aA'), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(10 + 5, 6);
  });

  it('exits immediately when the head already sits on the left board edge', () => {
    const path = buildExitPath(makeBoard('Aa'), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(10 + 5, 6);
  });

  it('rejects a segmentId the caller controls but got wrong', () => {
    expect(() => buildExitPath(ACYCLIC_BOARD, 0, viewport)).toThrow(RangeError);
    expect(() => buildExitPath(ACYCLIC_BOARD, 4, viewport)).toThrow(RangeError);
    expect(() => buildExitPath(ACYCLIC_BOARD, 1.5, viewport)).toThrow(RangeError);
  });

  it('rejects a malformed segDir rather than building a garbage ray', () => {
    const board = ACYCLIC_BOARD;
    const original = board.segDir[0];
    board.segDir[0] = 255;
    try {
      expect(() => buildExitPath(board, 1, viewport)).toThrow(RangeError);
    } finally {
      board.segDir[0] = original as number;
    }
  });
});

describe('drawSnakeOutFrame', () => {
  const viewport = createViewport({ scale: 10 });

  it('strokes the concatenated path as one polyline, moveTo first then lineTo in path order', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    const ctx = new FakeCtx();
    drawSnakeOutFrame(ctx, path, 0);

    const strokeIndex = ctx.calls.findIndex((c) => c.op === 'stroke');
    const moveAndLine = ctx.calls
      .slice(0, strokeIndex)
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo');
    expect(moveAndLine[0]).toEqual({ op: 'moveTo', x: 5, y: 5 });
    expect(moveAndLine.slice(1)).toEqual(
      Array.from(path.xs)
        .slice(1)
        .map((x, i) => ({ op: 'lineTo', x, y: path.ys[i + 1] })),
    );
    expect(ctx.calls.filter((c) => c.op === 'stroke')).toHaveLength(1);
  });

  it('advances the dash offset monotonically with progress and lands exactly at the end', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    const offsets = [0, 0.25, 0.5, 0.75, 1].map((progress) => {
      const ctx = new FakeCtx();
      drawSnakeOutFrame(ctx, path, progress);
      const stroke = ctx.calls.find((c) => c.op === 'stroke');
      return stroke && stroke.op === 'stroke' ? stroke.offset : NaN;
    });
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeLessThanOrEqual(offsets[i - 1] as number);
    }
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(-path.totalLength);
  });

  it('keeps the dash length fixed at the segment length across every frame', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    for (const progress of [0, 0.3, 0.6, 1]) {
      const ctx = new FakeCtx();
      drawSnakeOutFrame(ctx, path, progress);
      const setDash = ctx.calls.find((c) => c.op === 'setLineDash');
      expect(setDash && setDash.op === 'setLineDash' ? setDash.segments[0] : undefined).toBe(
        path.dashLength,
      );
    }
  });

  it('hides the leading arrowhead once the piece has fully exited', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    const midCtx = new FakeCtx();
    drawSnakeOutFrame(midCtx, path, 0.5);
    expect(midCtx.calls.some((c) => c.op === 'fill')).toBe(true);

    const endCtx = new FakeCtx();
    drawSnakeOutFrame(endCtx, path, 1);
    expect(endCtx.calls.some((c) => c.op === 'fill')).toBe(false);
  });

  it('draws only the moving arrowhead for a one-cell segment, never a stroke', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'E' } });
    const path = buildExitPath(board, 1, viewport);
    const ctx = new FakeCtx();
    drawSnakeOutFrame(ctx, path, 0.5);
    expect(ctx.calls.some((c) => c.op === 'stroke')).toBe(false);
    expect(ctx.calls.some((c) => c.op === 'fill')).toBe(true);
  });

  it('clamps an out-of-range progress rather than drawing a garbage window', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    const over = new FakeCtx();
    drawSnakeOutFrame(over, path, 1.5);
    const under = new FakeCtx();
    drawSnakeOutFrame(under, path, 1);
    expect(over.calls).toEqual(under.calls);
  });

  it('rejects a non-finite progress rather than silently drawing nothing', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    const ctx = new FakeCtx();
    expect(() => drawSnakeOutFrame(ctx, path, NaN)).toThrow(RangeError);
  });
});

describe('startSnakeOutAnimation', () => {
  const viewport = createViewport({ scale: 10 });

  it('rejects a durationMs the caller controls but got wrong', () => {
    const { layer } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() =>
        startSnakeOutAnimation({
          board: ACYCLIC_BOARD,
          segmentId: 1,
          viewport,
          durationMs: bad,
          layer,
          scheduler,
          onComplete: () => {},
        }),
      ).toThrow(RangeError);
    }
  });

  it('rejects a segmentId the caller controls but got wrong', () => {
    const { layer } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    expect(() =>
      startSnakeOutAnimation({
        board: ACYCLIC_BOARD,
        segmentId: 99,
        viewport,
        durationMs: 300,
        layer,
        scheduler,
        onComplete: () => {},
      }),
    ).toThrow(RangeError);
  });

  it('draws the resting frame synchronously and completes exactly once when elapsed time reaches the duration', () => {
    const { layer, ctx } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    let completions = 0;

    startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport,
      durationMs: 300,
      layer,
      scheduler,
      onComplete: () => {
        completions++;
      },
    });

    expect(ctx.calls.some((c) => c.op === 'stroke')).toBe(true);
    expect(scheduler.frames.size).toBe(1);
    expect(completions).toBe(0);

    scheduler.clock.value = 150;
    runQueuedFrames(scheduler, scheduler.clock.value);
    expect(completions).toBe(0);
    expect(scheduler.frames.size).toBe(1);

    scheduler.clock.value = 300;
    runQueuedFrames(scheduler, scheduler.clock.value);
    expect(completions).toBe(1);
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.visibleSubscribers.size).toBe(0);

    // A stray extra frame or visibility event after completion must never fire again.
    scheduler.fireVisible();
    expect(completions).toBe(1);
  });

  it('settles a backgrounded animation on the next visibility event, exactly once, even if frames never resume', () => {
    const { layer } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    let completions = 0;

    startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport,
      durationMs: 300,
      layer,
      scheduler,
      onComplete: () => {
        completions++;
      },
    });

    // The tab is backgrounded: no queued frame ever runs again.
    scheduler.clock.value = 100;
    scheduler.fireVisible(); // still short of the duration — must not settle yet
    expect(completions).toBe(0);

    scheduler.clock.value = 301;
    scheduler.fireVisible();
    expect(completions).toBe(1);

    scheduler.fireVisible();
    expect(completions).toBe(1);
  });

  it('cancel stops the animation and never calls onComplete, even if a stray frame still fires', () => {
    const { layer } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    let completions = 0;

    const handle = startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport,
      durationMs: 300,
      layer,
      scheduler,
      onComplete: () => {
        completions++;
      },
    });

    const strayFrame = [...scheduler.frames.values()][0] as (time: number) => void;
    handle.cancel();
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.visibleSubscribers.size).toBe(0);

    scheduler.clock.value = 1000;
    strayFrame(1000);
    scheduler.fireVisible();
    expect(completions).toBe(0);

    // cancel is safe to call again.
    expect(() => handle.cancel()).not.toThrow();
  });

  it('completes immediately, without throwing, when the segment itself is malformed', () => {
    const board = ACYCLIC_BOARD;
    const original = board.segDir[0];
    board.segDir[0] = 255;
    try {
      const { layer, ctx } = fakeAnimationLayer();
      const scheduler = fakeScheduler();
      let completions = 0;

      startSnakeOutAnimation({
        board,
        segmentId: 1,
        viewport,
        durationMs: 300,
        layer,
        scheduler,
        onComplete: () => {
          completions++;
        },
      });

      expect(scheduler.frames.size).toBe(1);
      runQueuedFrames(scheduler, 0);
      expect(completions).toBe(1);
      // The layer is left clear, not holding a half-drawn malformed segment.
      expect(ctx.calls.filter((c) => c.op === 'clearRect').length).toBeGreaterThan(0);
    } finally {
      board.segDir[0] = original as number;
    }
  });

  it('never touches the static layer', () => {
    const staticCtx = new FakeCtx();
    const staticCanvas: CanvasLike = {
      width: 80,
      height: 80,
      getContext: () => staticCtx as unknown as CanvasRenderingContext2D,
    };
    const staticLayer: StaticLayer = {
      canvas: staticCanvas,
      ctx: staticCtx as unknown as CanvasRenderingContext2D,
      budget: { pixelsPerCell: 20, widthPx: 80, heightPx: 80, degraded: false },
      viewport: createBufferViewport(20),
      allocationOk: true,
      attempts: [],
      droppedSegments: [],
    };
    redrawStaticLayer(staticLayer, ACYCLIC_BOARD, new Set());
    const callsAfterRedraw = staticCtx.calls.length;

    const { layer } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport,
      durationMs: 100,
      layer,
      scheduler,
      onComplete: () => {},
    });
    scheduler.clock.value = 50;
    runQueuedFrames(scheduler, 50);
    scheduler.clock.value = 100;
    runQueuedFrames(scheduler, 100);

    expect(staticCtx.calls.length).toBe(callsAfterRedraw);
  });
});
