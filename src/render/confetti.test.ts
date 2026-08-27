import { describe, expect, it } from 'vitest';
import {
  CONFETTI_DURATION_MS,
  advanceConfetti,
  confettiAlpha,
  createConfettiField,
  drawConfettiFrame,
  recommendedConfettiCount,
  resizeConfettiField,
  startConfettiAnimation,
  type ConfettiContext2D,
  type ConfettiField,
} from './confetti.js';
import { createAnimationLayer, type AnimationLayer, type CanvasLike } from './layers.js';
import { PALETTE } from './palette.js';
import type { SnakeOutScheduler } from './animate.js';

type Call =
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'translate'; x: number; y: number }
  | { op: 'rotate'; angle: number }
  | { op: 'fillRect'; x: number; y: number; w: number; h: number; color: string; alpha: number }
  | { op: 'clearRect' }
  | { op: 'setTransform' }
  | { op: 'scale' };

class FakeCtx implements ConfettiContext2D {
  readonly calls: Call[] = [];
  globalAlpha = 1;
  fillStyle = '';

  save(): void {
    this.calls.push({ op: 'save' });
  }
  restore(): void {
    this.calls.push({ op: 'restore' });
  }
  translate(x: number, y: number): void {
    this.calls.push({ op: 'translate', x, y });
  }
  rotate(angle: number): void {
    this.calls.push({ op: 'rotate', angle });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({
      op: 'fillRect',
      x,
      y,
      w,
      h,
      color: this.fillStyle,
      alpha: this.globalAlpha,
    });
  }
  clearRect(): void {
    this.calls.push({ op: 'clearRect' });
  }
  setTransform(): void {
    this.calls.push({ op: 'setTransform' });
  }
  scale(): void {
    this.calls.push({ op: 'scale' });
  }
}

function fakeAnimationLayer(
  cssWidth = 300,
  cssHeight = 600,
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
  const layer = createAnimationLayer(cssWidth, cssHeight, 1, () => canvas);
  return { layer, ctx: ctx as FakeCtx };
}

function fakeScheduler(): SnakeOutScheduler & {
  clock: { value: number };
  frames: Map<number, (time: number) => void>;
  fireVisible(): void;
  visibleSubscribers: Set<() => void>;
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

function runQueuedFrames(scheduler: ReturnType<typeof fakeScheduler>, time: number): void {
  const due = [...scheduler.frames.entries()].sort((a, b) => a[0] - b[0]);
  for (const [id, callback] of due) {
    scheduler.frames.delete(id);
    callback(time);
  }
}

const FIELD_OPTIONS = { cssWidth: 300, cssHeight: 600, seed: 7, count: 40 };

describe('recommendedConfettiCount', () => {
  it('stays inside a fixed band whatever the screen size', () => {
    expect(recommendedConfettiCount(320, 480)).toBeGreaterThanOrEqual(60);
    expect(recommendedConfettiCount(3840, 2160)).toBeLessThanOrEqual(220);
  });

  it('gives a bigger screen more flakes, up to the cap', () => {
    expect(recommendedConfettiCount(800, 600)).toBeGreaterThan(recommendedConfettiCount(320, 480));
  });

  it('rejects a canvas with no area', () => {
    expect(() => recommendedConfettiCount(0, 100)).toThrow(RangeError);
  });
});

describe('createConfettiField', () => {
  it('starts every flake on the burst origin', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, originX: 40, originY: 90 });
    expect([...field.x].every((x) => x === 40)).toBe(true);
    expect([...field.y].every((y) => y === 90)).toBe(true);
  });

  it('defaults the origin to the middle of the canvas', () => {
    const field = createConfettiField(FIELD_OPTIONS);
    expect(field.x[0]).toBe(150);
    expect(field.y[0]).toBe(300);
  });

  it('launches every flake at some speed, most of them upward', () => {
    const field = createConfettiField(FIELD_OPTIONS);
    expect([...field.vy].every((vy) => Number.isFinite(vy))).toBe(true);
    expect([...field.vx].some((vx) => vx > 0)).toBe(true);
    expect([...field.vx].some((vx) => vx < 0)).toBe(true);
    const rising = [...field.vy].filter((vy) => vy < 0).length;
    expect(rising).toBeGreaterThan(field.count / 2);
  });

  it('only ever colours a flake from the palette', () => {
    const field = createConfettiField(FIELD_OPTIONS);
    expect([...field.colors].every((c) => c >= 0 && c < PALETTE.length)).toBe(true);
  });

  it('gives the same burst for the same seed and a different one otherwise', () => {
    const a = createConfettiField(FIELD_OPTIONS);
    const b = createConfettiField(FIELD_OPTIONS);
    const other = createConfettiField({ ...FIELD_OPTIONS, seed: 8 });
    expect([...a.vx]).toEqual([...b.vx]);
    expect([...a.vx]).not.toEqual([...other.vx]);
  });

  it('scales the burst to the shorter canvas edge, so a phone sees what a desktop does', () => {
    const small = createConfettiField(FIELD_OPTIONS);
    const large = createConfettiField({ ...FIELD_OPTIONS, cssWidth: 600, cssHeight: 1200 });
    expect(large.gravity).toBeCloseTo(small.gravity * 2, 6);
    expect(large.halfWidth[0] as number).toBeCloseTo((small.halfWidth[0] as number) * 2, 4);
  });

  it('rejects a canvas with no area and a count that is not a whole number of flakes', () => {
    expect(() => createConfettiField({ ...FIELD_OPTIONS, cssHeight: 0 })).toThrow(RangeError);
    expect(() => createConfettiField({ ...FIELD_OPTIONS, count: 2.5 })).toThrow(RangeError);
    expect(() => createConfettiField({ ...FIELD_OPTIONS, count: -1 })).toThrow(RangeError);
  });
});

describe('advanceConfetti', () => {
  it('pulls a flake at rest downward', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 1 });
    field.vx[0] = 0;
    field.vy[0] = 0;
    advanceConfetti(field, 0.1);
    expect(field.vy[0]).toBeGreaterThan(0);
    expect(field.y[0] as number).toBeGreaterThan(300);
  });

  it('bleeds horizontal speed off, since only drag acts across', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 1 });
    field.vx[0] = 100;
    advanceConfetti(field, 0.2);
    expect(field.vx[0]).toBeGreaterThan(0);
    expect(field.vx[0]).toBeLessThan(100);
  });

  it('turns a flake as it travels', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 4 });
    const before = [...field.rot];
    advanceConfetti(field, 0.1);
    expect([...field.rot]).not.toEqual(before);
  });

  it('ignores a step that is zero, negative or not a number', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 3 });
    const before = [...field.y];
    advanceConfetti(field, 0);
    advanceConfetti(field, -1);
    advanceConfetti(field, Number.NaN);
    expect([...field.y]).toEqual(before);
  });
});

describe('resizeConfettiField', () => {
  it('moves the edges flakes are culled against', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 1 });
    resizeConfettiField(field, 800, 900);
    expect(field.cssWidth).toBe(800);
    expect(field.cssHeight).toBe(900);
  });

  it('keeps the flakes at the speeds and sizes they launched with', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 6 });
    const speeds = [...field.vx];
    const gravity = field.gravity;
    const sizes = [...field.halfWidth];
    resizeConfettiField(field, 800, 900);
    expect([...field.vx]).toEqual(speeds);
    expect([...field.halfWidth]).toEqual(sizes);
    expect(field.gravity).toBe(gravity);
  });

  it('ignores a canvas with no area, rather than culling everything away', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 1 });
    resizeConfettiField(field, 0, 900);
    resizeConfettiField(field, Number.NaN, 900);
    resizeConfettiField(field, 800, -1);
    expect(field.cssWidth).toBe(FIELD_OPTIONS.cssWidth);
    expect(field.cssHeight).toBe(FIELD_OPTIONS.cssHeight);
  });
});

describe('confettiAlpha', () => {
  it('holds the burst solid, then fades it out by the end', () => {
    expect(confettiAlpha(0)).toBe(1);
    expect(confettiAlpha(0.5)).toBe(1);
    expect(confettiAlpha(1)).toBe(0);
    const early = confettiAlpha(0.8);
    const late = confettiAlpha(0.95);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });
});

describe('drawConfettiFrame', () => {
  const onScreen = (field: ConfettiField, ctx: FakeCtx): Call[] => (
    drawConfettiFrame(ctx, field, 1),
    ctx.calls.filter((call) => call.op === 'fillRect')
  );

  it('draws one rotated rectangle per flake, in its own palette colour', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 5 });
    const ctx = new FakeCtx();
    const rects = onScreen(field, ctx);
    expect(rects).toHaveLength(5);
    expect(ctx.calls.filter((call) => call.op === 'save')).toHaveLength(5);
    expect(ctx.calls.filter((call) => call.op === 'restore')).toHaveLength(5);
    expect(ctx.calls.filter((call) => call.op === 'rotate')).toHaveLength(5);
    for (const rect of rects) {
      expect(PALETTE).toContain((rect as { color: string }).color);
    }
  });

  it('skips a flake that has fallen off the canvas', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 3 });
    field.y[0] = field.cssHeight + 500;
    field.x[1] = -500;
    const ctx = new FakeCtx();
    expect(onScreen(field, ctx)).toHaveLength(1);
  });

  it('draws a flake a wider canvas has room for once the field is resized', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 1 });
    field.x[0] = field.cssWidth + 200;
    expect(onScreen(field, new FakeCtx())).toHaveLength(0);

    resizeConfettiField(field, field.cssWidth + 400, field.cssHeight);
    expect(onScreen(field, new FakeCtx())).toHaveLength(1);
  });

  it('carries the fade into every flake and restores the context alpha', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 3 });
    const ctx = new FakeCtx();
    ctx.globalAlpha = 1;
    drawConfettiFrame(ctx, field, 0.25);
    const rects = ctx.calls.filter((call) => call.op === 'fillRect');
    expect(rects).toHaveLength(3);
    for (const rect of rects) expect((rect as { alpha: number }).alpha).toBe(0.25);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('draws nothing once the burst has faded out', () => {
    const field = createConfettiField({ ...FIELD_OPTIONS, count: 3 });
    const ctx = new FakeCtx();
    drawConfettiFrame(ctx, field, 0);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('startConfettiAnimation', () => {
  const start = (
    overrides: Partial<Parameters<typeof startConfettiAnimation>[0]> = {},
  ): {
    scheduler: ReturnType<typeof fakeScheduler>;
    ctx: FakeCtx;
    completions: number[];
    animation: ReturnType<typeof startConfettiAnimation>;
  } => {
    const scheduler = fakeScheduler();
    const { layer, ctx } = fakeAnimationLayer();
    const completions: number[] = [];
    const animation = startConfettiAnimation({
      layer,
      scheduler,
      durationMs: CONFETTI_DURATION_MS,
      seed: 3,
      count: 12,
      onComplete: () => completions.push(scheduler.clock.value),
      ...overrides,
    });
    return { scheduler, ctx, completions, animation };
  };

  it('rejects a duration no burst can run for', () => {
    const scheduler = fakeScheduler();
    const { layer } = fakeAnimationLayer();
    expect(() => startConfettiAnimation({ layer, scheduler, durationMs: 0, seed: 1 })).toThrow(
      RangeError,
    );
  });

  it('paints the burst on the frame it starts, before any frame has run', () => {
    const { ctx } = start();
    expect(ctx.calls.filter((call) => call.op === 'fillRect').length).toBeGreaterThan(0);
  });

  it('repaints on every frame, clearing what the last one drew', () => {
    const { scheduler, ctx } = start();
    ctx.calls.length = 0;
    scheduler.clock.value = 100;
    runQueuedFrames(scheduler, 100);
    expect(ctx.calls.filter((call) => call.op === 'clearRect').length).toBe(1);
    expect(ctx.calls.filter((call) => call.op === 'fillRect').length).toBeGreaterThan(0);
    expect(scheduler.frames.size).toBe(1);
  });

  it('moves the flakes between frames', () => {
    const { scheduler, ctx } = start();
    scheduler.clock.value = 40;
    runQueuedFrames(scheduler, 40);
    const first = ctx.calls.filter((call) => call.op === 'translate');
    ctx.calls.length = 0;
    scheduler.clock.value = 80;
    runQueuedFrames(scheduler, 80);
    const second = ctx.calls.filter((call) => call.op === 'translate');
    expect(second).not.toEqual(first);
  });

  it('completes once, clearing the layer, when the duration is up', () => {
    const { scheduler, ctx, completions } = start();
    scheduler.clock.value = CONFETTI_DURATION_MS + 1;
    ctx.calls.length = 0;
    runQueuedFrames(scheduler, scheduler.clock.value);
    expect(completions).toHaveLength(1);
    expect(ctx.calls.filter((call) => call.op === 'clearRect')).toHaveLength(1);
    expect(scheduler.frames.size).toBe(0);
  });

  it('completes on returning to a tab that was hidden past the end', () => {
    const { scheduler, completions } = start();
    scheduler.clock.value = CONFETTI_DURATION_MS + 500;
    scheduler.fireVisible();
    expect(completions).toHaveLength(1);
    // The catch-up unsubscribes, so a second visibility change adds nothing.
    scheduler.fireVisible();
    expect(completions).toHaveLength(1);
  });

  it('does not complete on returning to a tab while the burst is still running', () => {
    const { scheduler, completions } = start();
    scheduler.clock.value = 100;
    scheduler.fireVisible();
    expect(completions).toHaveLength(0);
  });

  it('cancel stops the burst, clears it, and never completes', () => {
    const { scheduler, ctx, completions, animation } = start();
    ctx.calls.length = 0;
    animation.cancel();
    animation.cancel();
    expect(completions).toHaveLength(0);
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.visibleSubscribers.size).toBe(0);
    expect(ctx.calls.filter((call) => call.op === 'clearRect')).toHaveLength(1);
  });

  it('completes on a frame rather than throwing when the layer cannot be read', () => {
    const scheduler = fakeScheduler();
    const completions: number[] = [];
    const animation = startConfettiAnimation({
      layer: () => {
        throw new Error('no layer');
      },
      scheduler,
      durationMs: CONFETTI_DURATION_MS,
      seed: 1,
      onComplete: () => completions.push(scheduler.clock.value),
    });
    expect(completions).toHaveLength(0);
    runQueuedFrames(scheduler, 0);
    expect(completions).toHaveLength(1);
    animation.cancel();
    expect(completions).toHaveLength(1);
  });

  it('draws out to the new edges when the layer is resized mid-burst', () => {
    /** Flakes painted on one late frame, of a burst opened on a 100x100 layer. */
    const flakesOnALateFrame = (grow: boolean): number => {
      const scheduler = fakeScheduler();
      const small = fakeAnimationLayer(100, 100);
      const large = fakeAnimationLayer(600, 600);
      let current = small;
      startConfettiAnimation({
        layer: () => current.layer,
        scheduler,
        durationMs: CONFETTI_DURATION_MS,
        seed: 5,
        count: 60,
      });
      if (grow) current = large;
      // Stepped small enough that the driver integrates every frame whole,
      // and far enough for flakes to have travelled past the opening canvas.
      for (let time = 40; time <= 960; time += 40) {
        scheduler.clock.value = time;
        runQueuedFrames(scheduler, time);
      }
      current.ctx.calls.length = 0;
      scheduler.clock.value = 1000;
      runQueuedFrames(scheduler, 1000);
      return current.ctx.calls.filter((call) => call.op === 'translate').length;
    };

    // Only a flake that survives the cull is translated, and the two runs are
    // the same burst on the same clock: the canvas is the only difference.
    expect(flakesOnALateFrame(true)).toBeGreaterThan(flakesOnALateFrame(false));
  });

  it('completes when the layer goes away mid-burst', () => {
    const scheduler = fakeScheduler();
    const { layer } = fakeAnimationLayer();
    let live = true;
    const completions: number[] = [];
    startConfettiAnimation({
      layer: () => {
        if (!live) throw new Error('layer replaced');
        return layer;
      },
      scheduler,
      durationMs: CONFETTI_DURATION_MS,
      seed: 1,
      count: 8,
      onComplete: () => completions.push(scheduler.clock.value),
    });
    live = false;
    scheduler.clock.value = 60;
    runQueuedFrames(scheduler, 60);
    expect(completions).toHaveLength(1);
    expect(scheduler.frames.size).toBe(0);
  });
});
