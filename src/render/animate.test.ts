import { describe, expect, it } from 'vitest';
import {
  buildExitPath,
  drawSnakeOutFrame,
  startSnakeOutAnimation,
  viewportChanged,
  type SnakeOutScheduler,
} from './animate.js';
import { createAnimationLayer, redrawStaticLayer, type CanvasLike } from './layers.js';
import { ARROWHEAD_LENGTH_CELLS, LINE_WIDTH_CELLS } from './draw.js';
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
    // dashLength = 4 polyline edges * scale 10 = 40. The on-board run (4 polyline
    // edges + 2 ray edges) is 6 * 10 = 60, so the board's true edge sits at
    // 60 + 5 = 65. dashLength (40) already exceeds a full arrowhead's reach
    // (10), so the dash's own body carries the head clear on its own:
    // totalLength is just the 65 to the true edge. The last vertex still has
    // to carry the head, which leads the trailing edge by dashLength, so it
    // sits totalLength + dashLength - 60 = 45 past the last on-board vertex
    // (y = 35), landing at y = 80.
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    expect(Array.from(path.xs)).toEqual([5, 15, 25, 35, 35, 35, 35, 35]);
    expect(Array.from(path.ys)).toEqual([5, 5, 5, 5, 15, 25, 35, 80]);
    expect(Array.from(path.edgeDirs)).toEqual([1, 1, 1, 2, 2, 2, 2]); // E,E,E,S,S,S,S
    expect(path.dashLength).toBe(40);
    expect(path.totalLength).toBe(65);
  });

  it('is dashLength 0 for a one-cell segment, with a ray-only path', () => {
    // A 1x1 board: the head is already on every edge, so the on-board run is
    // just the half-cell to the true edge (5). dashLength is 0 (no body), so
    // totalLength is that 5 plus a full arrowhead's reach (10): 15. The final
    // vertex is totalLength + dashLength - 0 = 15 past the head, at x = 20.
    const board = makeBoard({ art: 'A', dirs: { a: 'E' } });
    const path = buildExitPath(board, 1, viewport);
    expect(Array.from(path.xs)).toEqual([5, 20]);
    expect(Array.from(path.ys)).toEqual([5, 5]);
    expect(path.dashLength).toBe(0);
    expect(path.totalLength).toBe(15);
  });

  it('steps the ray north, away from the head, toward the top edge', () => {
    // 1 cell + 2 on-board ray cells, no polyline: the on-board run is
    // 2 * 10 = 20, so the true edge sits at 20 + 5 = 25. dashLength is 0, so
    // totalLength adds only a full arrowhead's reach (10): 35.
    const board = makeBoard({ art: ['...', '...', '.A.'].join('\n'), dirs: { a: 'N' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(35, 6);
  });

  it('steps the ray south, toward the bottom edge', () => {
    // 1 cell + 2 on-board ray cells, no polyline: the on-board run is
    // 2 * 10 = 20, so the true edge sits at 20 + 5 = 25. dashLength is 0, so
    // totalLength adds only a full arrowhead's reach (10): 35.
    const board = makeBoard({ art: ['.A.', '...', '...'].join('\n'), dirs: { a: 'S' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(35, 6);
  });

  it('steps the ray east, toward the right edge', () => {
    // 1 cell + 2 on-board ray cells, no polyline: the on-board run is
    // 2 * 10 = 20, so the true edge sits at 20 + 5 = 25. dashLength is 0, so
    // totalLength adds only a full arrowhead's reach (10): 35.
    const board = makeBoard({ art: ['A..', '...', '...'].join('\n'), dirs: { a: 'E' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(35, 6);
  });

  it('steps the ray west, toward the left edge', () => {
    // 1 cell + 2 on-board ray cells, no polyline: the on-board run is
    // 2 * 10 = 20, so the true edge sits at 20 + 5 = 25. dashLength is 0, so
    // totalLength adds only a full arrowhead's reach (10): 35.
    const board = makeBoard({ art: ['..A', '...', '...'].join('\n'), dirs: { a: 'W' } });
    const path = buildExitPath(board, 1, viewport);
    expect(path.xs.length).toBe(2 + 2);
    expect(path.totalLength).toBeCloseTo(35, 6);
  });

  it('exits immediately when the head already sits on the top board edge', () => {
    // 2-cell polyline, zero ray steps: the on-board run is 1 * 10 = 10 (the
    // one polyline edge), so the true edge sits at 10 + 5 = 15. dashLength
    // (10) equals a full arrowhead's reach (10), so no extra travel is
    // needed beyond the true edge: totalLength is 15.
    const path = buildExitPath(makeBoard(['A', 'a'].join('\n')), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(15, 6);
  });

  it('exits immediately when the head already sits on the bottom board edge', () => {
    // 2-cell polyline, zero ray steps: the on-board run is 1 * 10 = 10 (the
    // one polyline edge), so the true edge sits at 10 + 5 = 15. dashLength
    // (10) equals a full arrowhead's reach (10), so no extra travel is
    // needed beyond the true edge: totalLength is 15.
    const path = buildExitPath(makeBoard(['a', 'A'].join('\n')), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(15, 6);
  });

  it('exits immediately when the head already sits on the right board edge', () => {
    // 2-cell polyline, zero ray steps: the on-board run is 1 * 10 = 10 (the
    // one polyline edge), so the true edge sits at 10 + 5 = 15. dashLength
    // (10) equals a full arrowhead's reach (10), so no extra travel is
    // needed beyond the true edge: totalLength is 15.
    const path = buildExitPath(makeBoard('aA'), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(15, 6);
  });

  it('exits immediately when the head already sits on the left board edge', () => {
    // 2-cell polyline, zero ray steps: the on-board run is 1 * 10 = 10 (the
    // one polyline edge), so the true edge sits at 10 + 5 = 15. dashLength
    // (10) equals a full arrowhead's reach (10), so no extra travel is
    // needed beyond the true edge: totalLength is 15.
    const path = buildExitPath(makeBoard('Aa'), 1, viewport);
    expect(path.xs.length).toBe(3);
    expect(path.totalLength).toBeCloseTo(15, 6);
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

  it('rejects a segment with no cells rather than returning NaN lengths', () => {
    // drawSegmentGuarded has nothing to stroke or fill for a zero-cell
    // segment, so it reports success — buildExitPath is the one that has to
    // catch this, since it cannot rely on that guard the way draw.ts's own
    // functions do.
    const board = ACYCLIC_BOARD;
    const original = board.segStart[0];
    board.segStart[0] = board.segStart[1] as number; // segment 1 now spans zero cells
    try {
      expect(() => buildExitPath(board, 1, viewport)).toThrow(RangeError);
    } finally {
      board.segStart[0] = original as number;
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

  it('carries the arrowhead off the board rather than dropping it at the edge', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    // The board's true edge sits at arc length totalLength - max(0, arrowReach
    // - dashLength) (buildExitPath's own derivation, run in reverse — this
    // segment's dashLength already exceeds arrowReach, so that max is 0 and
    // the true edge is just totalLength). The arrowhead anchor (windowStart +
    // dashLength) reaches that edge once windowStart does, i.e. at this
    // progress.
    const arrowReach = ARROWHEAD_LENGTH_CELLS * viewport.scale;
    const edgeLength = path.totalLength - Math.max(0, arrowReach - path.dashLength);
    const headExitsAt = (edgeLength - path.dashLength) / path.totalLength;
    const boardBottom = 40; // 4 cells at scale 10, and this segment exits south

    const onBoard = new FakeCtx();
    drawSnakeOutFrame(onBoard, path, headExitsAt / 2);
    expect(onBoard.calls.some((c) => c.op === 'fill')).toBe(true);

    const past = new FakeCtx();
    drawSnakeOutFrame(past, path, (headExitsAt + 1) / 2);
    expect(past.calls.some((c) => c.op === 'fill')).toBe(true);
    const strokeAt = past.calls.findIndex((c) => c.op === 'stroke');
    const headYs = past.calls
      .slice(strokeAt + 1)
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => (c as { y: number }).y);
    expect(headYs.length).toBeGreaterThan(0);
    expect(Math.min(...headYs)).toBeGreaterThan(boardBottom);
  });

  it('keeps the arrowhead moving rather than parked while the head is still on the path', () => {
    const path = buildExitPath(ACYCLIC_BOARD, 1, viewport);
    const arrowReach = ARROWHEAD_LENGTH_CELLS * viewport.scale;
    const edgeLength = path.totalLength - Math.max(0, arrowReach - path.dashLength);
    const headExitsAt = (edgeLength - path.dashLength) / path.totalLength;
    const fillsAt = (t: number): string => {
      const ctx = new FakeCtx();
      drawSnakeOutFrame(ctx, path, t);
      return JSON.stringify(ctx.calls.filter((c) => c.op === 'lineTo' || c.op === 'moveTo'));
    };
    expect(fillsAt(headExitsAt * 0.3)).not.toBe(fillsAt(headExitsAt * 0.9));
  });

  it('draws only the moving arrowhead for a one-cell segment, never a stroke', () => {
    const board = makeBoard({ art: 'A', dirs: { a: 'E' } });
    const path = buildExitPath(board, 1, viewport);
    const ctx = new FakeCtx();
    drawSnakeOutFrame(ctx, path, 0.5);
    expect(ctx.calls.some((c) => c.op === 'stroke')).toBe(false);
    expect(ctx.calls.some((c) => c.op === 'fill')).toBe(true);
  });

  it('clears the whole arrowhead of a one-cell segment past the board edge by progress 1', () => {
    // A one-cell segment has dashLength 0, so its leading edge sits exactly
    // at the travel distance and only the path's own extension carries it
    // clear. Head at (1, 2), exiting south on a 3x3 board, true edge y = 30.
    const board = makeBoard({ art: ['...', '...', '.A.'].join('\n'), dirs: { a: 'S' } });
    const path = buildExitPath(board, 1, viewport);
    const boardBottom = 30;

    const ctx = new FakeCtx();
    drawSnakeOutFrame(ctx, path, 1);
    const moveTos = ctx.calls.filter(
      (c): c is Extract<Call, { op: 'moveTo' }> => c.op === 'moveTo',
    );
    // fillArrowheadAt's tip is the first point of the triangle, i.e. the last
    // moveTo issued, and its base trails it by half an arrowhead length — the
    // point closest to the board, so it is the one that has to clear the edge.
    const half = (ARROWHEAD_LENGTH_CELLS * path.scale) / 2;
    const tip = moveTos[moveTos.length - 1] as Extract<Call, { op: 'moveTo' }>;
    expect(tip.y - half).toBeGreaterThan(boardBottom);
  });

  it('never places the arrowhead beyond the vertices its own path built', () => {
    // The bug this guards: extrapolating the lead position past the path's
    // last vertex detaches the arrowhead from the body it's supposed to lead.
    for (const board of [
      ACYCLIC_BOARD,
      makeBoard({ art: 'A', dirs: { a: 'E' } }),
      makeBoard('aaaaA'), // straight 5-cell segment exiting east
    ]) {
      const path = buildExitPath(board, 1, viewport);
      // The tip sits half an arrowhead length beyond the anchor, and the
      // anchor itself is always a point on one of the path's own edges — so
      // the tip is bounded by the path's own vertices widened by that half,
      // never further, regardless of which edge direction it lands on.
      const half = (ARROWHEAD_LENGTH_CELLS * path.scale) / 2;
      const minX = Math.min(...path.xs) - half;
      const maxX = Math.max(...path.xs) + half;
      const minY = Math.min(...path.ys) - half;
      const maxY = Math.max(...path.ys) + half;
      for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const ctx = new FakeCtx();
        drawSnakeOutFrame(ctx, path, progress);
        const moveTos = ctx.calls.filter(
          (c): c is Extract<Call, { op: 'moveTo' }> => c.op === 'moveTo',
        );
        const tip = moveTos[moveTos.length - 1] as Extract<Call, { op: 'moveTo' }>;
        expect(tip.x).toBeGreaterThanOrEqual(minX);
        expect(tip.x).toBeLessThanOrEqual(maxX);
        expect(tip.y).toBeGreaterThanOrEqual(minY);
        expect(tip.y).toBeLessThanOrEqual(maxY);
      }
    }
  });

  it('keeps the head attached to the body, on the same path, past the board edge', () => {
    // A straight 5-cell segment ("aaaaA") exiting east on a 5-wide board at
    // scale 10, sampled at progress 0.9. dashLength = 4 * 10 = 40 exceeds a full
    // arrowhead's reach (10), so the on-board run (also 40) is all the
    // travel totalLength needs: 45 (40 + the half-cell to the true edge).
    // The final edge still has to carry the head, which leads the trailing
    // edge by dashLength, so it runs from x = 45 to
    // x = 45 + (totalLength + dashLength - 40) = 45 + 45 = 90.
    //
    // At progress 0.9, windowStart = 40.5 and the arrowhead anchor sits at
    // windowStart + dashLength = 80.5 along the path — 90% of the way along
    // the final edge, i.e. x = 45 + 0.9 * 45 = 85.5, a point on the same
    // vertices the stroke itself uses.
    const board = makeBoard('aaaaA');
    const path = buildExitPath(board, 1, viewport);
    expect(path.totalLength).toBe(45);

    const ctx = new FakeCtx();
    drawSnakeOutFrame(ctx, path, 0.9);

    expect(ctx.calls.some((c) => c.op === 'stroke')).toBe(true);
    const moveTos = ctx.calls.filter(
      (c): c is Extract<Call, { op: 'moveTo' }> => c.op === 'moveTo',
    );
    const tip = moveTos[moveTos.length - 1] as Extract<Call, { op: 'moveTo' }>;
    const half = (ARROWHEAD_LENGTH_CELLS * path.scale) / 2;
    expect(tip.x - half).toBeCloseTo(85.5, 6); // the anchor, tip minus half the arrowhead's length
    expect(tip.y).toBe(5);
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
    const { layer, ctx } = fakeAnimationLayer();
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
    const callsAfterCancel = ctx.calls.length;

    // Mid-flight, not past the duration: a stray frame reaching this point
    // takes the "still running" branch, the one a missing settled check in
    // step() would repaint and reschedule from.
    scheduler.clock.value = 100;
    strayFrame(100);
    expect(completions).toBe(0);
    expect(scheduler.frames.size).toBe(0); // must not have rescheduled itself
    expect(ctx.calls.length).toBe(callsAfterCancel); // must not have repainted

    scheduler.clock.value = 1000;
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

  it('completes immediately, without throwing, when the segment has no cells', () => {
    // drawSegmentGuarded reports success for a zero-cell segment (nothing to
    // draw, nothing to fail), so this only passes if the driver also guards
    // buildExitPath's own throw for the same segment.
    const board = ACYCLIC_BOARD;
    const original = board.segStart[0];
    board.segStart[0] = board.segStart[1] as number;
    try {
      const { layer } = fakeAnimationLayer();
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
    } finally {
      board.segStart[0] = original as number;
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

describe('startSnakeOutAnimation, mid-flight changes', () => {
  it('clears the animation layer on cancel rather than stranding a half-drawn segment', () => {
    const { layer, ctx } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    const animation = startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport: createViewport({ scale: 10 }),
      durationMs: 300,
      layer,
      scheduler,
      onComplete: () => {},
    });

    scheduler.clock.value = 150;
    runQueuedFrames(scheduler, 150);
    const drawnBeforeCancel = ctx.calls.length;

    animation.cancel();

    const clearsAfterCancel = ctx.calls
      .slice(drawnBeforeCancel)
      .filter((c) => c.op === 'clearRect').length;
    expect(clearsAfterCancel).toBeGreaterThan(0);
  });

  it('rebuilds the path when a pan replaces the viewport during the exit', () => {
    const { layer, ctx } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    let viewport = createViewport({ scale: 10 });
    startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport: () => viewport,
      durationMs: 300,
      layer,
      scheduler,
      onComplete: () => {},
    });

    scheduler.clock.value = 100;
    runQueuedFrames(scheduler, 100);
    const beforePan = ctx.calls.filter((c) => c.op === 'moveTo');

    viewport = createViewport({ scale: 10, originX: 250, originY: 130 });
    scheduler.clock.value = 200;
    runQueuedFrames(scheduler, 200);
    const afterPan = ctx.calls.filter((c) => c.op === 'moveTo').slice(beforePan.length);

    expect(afterPan.length).toBeGreaterThan(0);
    expect(afterPan[0]).not.toEqual(beforePan[0]);
  });

  it('rebuilds the path when the viewport getter returns the same object mutated in place, not just a new one', () => {
    const { layer, ctx } = fakeAnimationLayer();
    const scheduler = fakeScheduler();
    const mutableViewport = { space: 'css' as const, scale: 10, dpr: 1, originX: 0, originY: 0 };
    startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport: () => mutableViewport,
      durationMs: 300,
      layer,
      scheduler,
      onComplete: () => {},
    });

    scheduler.clock.value = 100;
    runQueuedFrames(scheduler, 100);
    const strokesBefore = ctx.calls.filter(
      (c): c is Extract<Call, { op: 'stroke' }> => c.op === 'stroke',
    );
    const widthBefore = strokesBefore[strokesBefore.length - 1]?.width;

    mutableViewport.scale = 20; // same object reference, new value — no new getter result to compare against
    scheduler.clock.value = 200;
    runQueuedFrames(scheduler, 200);
    const strokesAfter = ctx.calls.filter(
      (c): c is Extract<Call, { op: 'stroke' }> => c.op === 'stroke',
    );
    const widthAfter = strokesAfter[strokesAfter.length - 1]?.width;

    expect(widthBefore).toBe(LINE_WIDTH_CELLS * 10);
    expect(widthAfter).toBe(LINE_WIDTH_CELLS * 20);
  });
});

describe('viewportChanged', () => {
  const base = createViewport({ scale: 10, originX: 5, originY: 3 });

  it('is false for two different objects with the same scale and origin', () => {
    const other = createViewport({ scale: 10, originX: 5, originY: 3 });
    expect(other).not.toBe(base);
    expect(viewportChanged(base, other)).toBe(false);
  });

  it('is true when scale differs', () => {
    expect(viewportChanged(base, { ...base, scale: 20 })).toBe(true);
  });

  it('is true when originX differs', () => {
    expect(viewportChanged(base, { ...base, originX: 6 })).toBe(true);
  });

  it('is true when originY differs', () => {
    expect(viewportChanged(base, { ...base, originY: 4 })).toBe(true);
  });
});

describe('startSnakeOutAnimation, teardown under a failing layer', () => {
  it('still completes and releases the scheduler when the layer is gone', () => {
    const scheduler = fakeScheduler();
    let alive = true;
    let completed = 0;
    startSnakeOutAnimation({
      board: ACYCLIC_BOARD,
      segmentId: 1,
      viewport: createViewport({ scale: 10 }),
      durationMs: 100,
      layer: () => {
        if (!alive) throw new Error('layer recreated mid-exit');
        return fakeAnimationLayer().layer;
      },
      scheduler,
      onComplete: () => {
        completed++;
      },
    });

    alive = false;
    scheduler.clock.value = 200;
    runQueuedFrames(scheduler, 200);

    expect(completed).toBe(1);
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.visibleSubscribers.size).toBe(0);
  });
});
