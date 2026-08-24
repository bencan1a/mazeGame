import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_DIMENSION,
  MIN_PIXELS_PER_CELL,
  clearAnimationLayer,
  computeBufferBudget,
  createAnimationLayer,
  createStaticLayer,
  degradeBudget,
  planDegradation,
  probeReadback,
  recommendedPixelsPerCell,
  redrawStaticLayer,
  removedSetsDiffer,
  type CanvasLike,
} from './layers.js';
import { ARROWHEAD_OVERHANG_CELLS, drawArrowhead } from './draw.js';
import { ACYCLIC_BOARD, makeBoard } from '../../test/fixtures/board.js';
import { createBufferViewport } from './viewport.js';
import type { Board } from '../core/types.js';

describe('computeBufferBudget', () => {
  it('grants the requested resolution when it fits under the cap', () => {
    const budget = computeBufferBudget(40, 40, 20);
    expect(budget).toEqual({ pixelsPerCell: 20, widthPx: 800, heightPx: 800, degraded: false });
  });

  it('caps a 100x100 board at 3x zoom to stay under the max dimension', () => {
    // 100 * 3 = 300px/cell would be 30000px; the cap forces it down.
    const budget = computeBufferBudget(100, 100, 300, 8192);
    expect(budget.widthPx).toBeLessThanOrEqual(8192);
    expect(budget.heightPx).toBeLessThanOrEqual(8192);
    expect(budget.degraded).toBe(true);
    expect(budget.pixelsPerCell).toBeCloseTo(81.92, 2);
  });

  it('handles a non-square board by capping on the longer side', () => {
    const budget = computeBufferBudget(200, 50, 100, 8192);
    expect(budget.widthPx).toBeLessThanOrEqual(8192);
    expect(budget.pixelsPerCell).toBeCloseTo(8192 / 200, 5);
  });

  it('never reports degraded when the request already fits', () => {
    const budget = computeBufferBudget(20, 20, 8192 / 20, 8192);
    expect(budget.degraded).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, 0, -5])(
    'rejects a requestedPixelsPerCell of %p rather than producing NaN geometry',
    (bad) => {
      expect(() => computeBufferBudget(40, 40, bad)).toThrow(RangeError);
    },
  );

  it.each([NaN, Infinity, 0, -1])('rejects a boardWidth of %p', (bad) => {
    expect(() => computeBufferBudget(bad, 40, 20)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, 0, -1])('rejects a maxDimension of %p', (bad) => {
    expect(() => computeBufferBudget(40, 40, 20, bad)).toThrow(RangeError);
  });
});

describe('recommendedPixelsPerCell', () => {
  it('is base CSS px per cell times the zoom ceiling times dpr', () => {
    expect(recommendedPixelsPerCell(1)).toBe(30); // 10 * 3 * 1
    expect(recommendedPixelsPerCell(2, 4, 5)).toBe(40); // 5 * 4 * 2
  });

  it('at dpr 3 on a 100x100 board, lands on the spike-measured cap of ~81 device px per cell', () => {
    const requested = recommendedPixelsPerCell(3);
    const budget = computeBufferBudget(100, 100, requested, MAX_CANVAS_DIMENSION);
    expect(budget.degraded).toBe(true);
    expect(budget.pixelsPerCell).toBeCloseTo(81.92, 2);
  });

  it('does not ask for the cap on a small board', () => {
    const requested = recommendedPixelsPerCell(1);
    const budget = computeBufferBudget(20, 20, requested, MAX_CANVAS_DIMENSION);
    expect(budget.degraded).toBe(false);
    expect(budget.widthPx).toBe(600);
    expect(budget.widthPx).toBeLessThan(MAX_CANVAS_DIMENSION);
  });
});

describe('degradeBudget', () => {
  it('halves pixelsPerCell and marks the result degraded', () => {
    const budget = computeBufferBudget(40, 40, 20);
    const degraded = degradeBudget(budget, 40, 40);
    expect(degraded.pixelsPerCell).toBe(10);
    expect(degraded.degraded).toBe(true);
  });

  it('does not go below the minimum pixels per cell', () => {
    const budget = computeBufferBudget(40, 40, MIN_PIXELS_PER_CELL);
    const degraded = degradeBudget(budget, 40, 40);
    expect(degraded.pixelsPerCell).toBeGreaterThanOrEqual(MIN_PIXELS_PER_CELL);
  });

  it('rejects a minPixelsPerCell above the current budget rather than raising resolution', () => {
    const budget = computeBufferBudget(40, 40, 2);
    expect(budget.pixelsPerCell).toBe(2);
    expect(() => degradeBudget(budget, 40, 40, MAX_CANVAS_DIMENSION, 10)).toThrow(RangeError);
  });
});

describe('planDegradation', () => {
  it('accepts the first attempt when the probe succeeds immediately', () => {
    const plan = planDegradation(40, 40, 20, () => true);
    expect(plan.attempts).toHaveLength(1);
    expect(plan.budget.pixelsPerCell).toBe(20);
    expect(plan.ok).toBe(true);
  });

  it('halves resolution until the probe succeeds', () => {
    let calls = 0;
    const plan = planDegradation(40, 40, 20, (budget) => {
      calls++;
      return budget.pixelsPerCell <= 5;
    });
    expect(calls).toBe(3); // 20 -> 10 -> 5
    expect(plan.budget.pixelsPerCell).toBe(5);
    expect(plan.budget.degraded).toBe(true);
    expect(plan.attempts.map((a) => a.ok)).toEqual([false, false, true]);
    expect(plan.ok).toBe(true);
  });

  it('gives up gracefully at the floor rather than looping forever', () => {
    const plan = planDegradation(40, 40, 20, () => false, { minPixelsPerCell: 2 });
    expect(plan.budget.pixelsPerCell).toBe(2);
    expect(plan.attempts.every((a) => !a.ok)).toBe(true);
    expect(plan.attempts.length).toBeGreaterThan(1);
    expect(plan.ok).toBe(false);
  });

  it('respects a custom max dimension', () => {
    const plan = planDegradation(100, 100, 300, () => true, { maxDimension: 1024 });
    expect(plan.budget.widthPx).toBeLessThanOrEqual(1024);
  });

  it('terminates within a bounded number of attempts even with an extreme floor', () => {
    const plan = planDegradation(100, 100, 8192, () => false, { minPixelsPerCell: 1e-6 });
    expect(plan.attempts.length).toBeLessThanOrEqual(64);
    expect(plan.ok).toBe(false);
  });

  it('rejects a non-finite requestedPixelsPerCell rather than looping forever', () => {
    expect(() => planDegradation(40, 40, NaN, () => true)).toThrow(RangeError);
    expect(() => planDegradation(40, 40, Infinity, () => true)).toThrow(RangeError);
  });

  it('rejects a non-finite minPixelsPerCell', () => {
    expect(() => planDegradation(40, 40, 20, () => true, { minPixelsPerCell: NaN })).toThrow(
      RangeError,
    );
  });

  it('when the attempt bound is reached before the floor, returns the last probed budget rather than one never tried', () => {
    // Halving from 100 needs far more than the attempt bound to reach 1e-20,
    // so the loop exhausts its bound without ever satisfying the floor check.
    const plan = planDegradation(40, 40, 100, () => false, { minPixelsPerCell: 1e-20 });
    const lastProbed = plan.attempts[plan.attempts.length - 1];
    expect(lastProbed).toBeDefined();
    expect(lastProbed?.budget.pixelsPerCell).toBeGreaterThan(1e-20);
    expect(plan.budget).toEqual(lastProbed?.budget);
    expect(plan.ok).toBe(false);
  });
});

describe('removedSetsDiffer', () => {
  it('is false for two empty sets', () => {
    expect(removedSetsDiffer(new Set(), new Set())).toBe(false);
  });

  it('is false when both sets hold the same ids', () => {
    expect(removedSetsDiffer(new Set([1, 2]), new Set([2, 1]))).toBe(false);
  });

  it('is true when sizes differ', () => {
    expect(removedSetsDiffer(new Set([1]), new Set([1, 2]))).toBe(true);
  });

  it('is true when sizes match but membership differs', () => {
    expect(removedSetsDiffer(new Set([1, 2]), new Set([1, 3]))).toBe(true);
  });
});

interface FakeTransform {
  readonly a: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const IDENTITY_TRANSFORM: FakeTransform = { a: 1, d: 1, e: 0, f: 0 };

/**
 * A minimal 2D-context fake with a device memory cap, to exercise the
 * readback probe without a real canvas. Tracks a scale+translate transform
 * (matching this codebase's only uses of `scale`/`setTransform`) so that,
 * like a real context, `fillRect`/`clearRect` honour it while
 * `getImageData` always reads raw backing-store pixels regardless of it.
 */
class FakeCtx {
  private pixels: Uint8ClampedArray;
  private transform: FakeTransform = IDENTITY_TRANSFORM;
  private readonly transformStack: FakeTransform[] = [];
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly allocated: boolean,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  fillStyle = '';
  save(): void {
    this.transformStack.push(this.transform);
  }
  restore(): void {
    this.transform = this.transformStack.pop() ?? IDENTITY_TRANSFORM;
  }
  readonly scaleCalls: [number, number][] = [];
  scale(sx: number, sy: number): void {
    this.scaleCalls.push([sx, sy]);
    this.transform = {
      a: this.transform.a * sx,
      d: this.transform.d * sy,
      e: this.transform.e,
      f: this.transform.f,
    };
  }
  setTransform(a: number, _b: number, _c: number, d: number, e: number, f: number): void {
    this.transform = { a, d, e, f };
  }
  getTransform(): FakeTransform {
    return this.transform;
  }
  private toRaw(x: number, y: number): [number, number] {
    return [this.transform.a * x + this.transform.e, this.transform.d * y + this.transform.f];
  }
  /**
   * Only pixels fully inside the transformed rect are touched — a
   * conservative model of sub-pixel coverage, so a rect that stops short of
   * a pixel's far edge leaves that pixel alone rather than rounding up to
   * cover it.
   */
  private writeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: [number, number, number, number],
  ): void {
    const [rx, ry] = this.toRaw(x, y);
    const rw = w * this.transform.a;
    const rh = h * this.transform.d;
    for (let py = Math.ceil(ry); py < Math.floor(ry + rh); py++) {
      for (let px = Math.ceil(rx); px < Math.floor(rx + rw); px++) {
        this.pokeRawPixel(px, py, rgba);
      }
    }
  }
  pokeRawPixel(x: number, y: number, rgba: [number, number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = rgba[0];
    this.pixels[i + 1] = rgba[1];
    this.pixels[i + 2] = rgba[2];
    this.pixels[i + 3] = rgba[3];
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.writeRect(x, y, w, h, [0, 0, 0, 0]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    if (!this.allocated) return;
    this.writeRect(x, y, w, h, [255, 0, 255, 255]);
  }
  getImageData(x: number, y: number, w: number, h: number): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
        const src = (py * this.width + px) * 4;
        const dst = (dy * w + dx) * 4;
        data[dst] = this.pixels[src] as number;
        data[dst + 1] = this.pixels[src + 1] as number;
        data[dst + 2] = this.pixels[src + 2] as number;
        data[dst + 3] = this.pixels[src + 3] as number;
      }
    }
    return { data, width: w, height: h, colorSpace: 'srgb' };
  }
  putImageData(image: ImageData, x: number, y: number): void {
    for (let dy = 0; dy < image.height; dy++) {
      for (let dx = 0; dx < image.width; dx++) {
        const src = (dy * image.width + dx) * 4;
        this.pokeRawPixel(x + dx, y + dy, [
          image.data[src] as number,
          image.data[src + 1] as number,
          image.data[src + 2] as number,
          image.data[src + 3] as number,
        ]);
      }
    }
  }
  // The rest of strokeSegmentPolyline's minimal surface.
  strokeStyle = '';
  lineWidth = 0;
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  closePath(): void {}
  fill(): void {}
}

function fakeCanvasFactory(allocationLimitPx: number): () => CanvasLike {
  return () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext(id: '2d') {
        if (id !== '2d') return null;
        const allocated = canvas.width * canvas.height <= allocationLimitPx;
        return new FakeCtx(
          canvas.width,
          canvas.height,
          allocated,
        ) as unknown as CanvasRenderingContext2D;
      },
    };
    return canvas;
  };
}

describe('probeReadback', () => {
  it('is true when the drawn pixel reads back', () => {
    const ctx = new FakeCtx(10, 10, true) as unknown as CanvasRenderingContext2D;
    expect(probeReadback(ctx, 10, 10)).toBe(true);
  });

  it('is false when the canvas silently failed to allocate', () => {
    const ctx = new FakeCtx(10, 10, false) as unknown as CanvasRenderingContext2D;
    expect(probeReadback(ctx, 10, 10)).toBe(false);
  });

  it('leaves no drawn pixel behind once the probe is done', () => {
    const fake = new FakeCtx(10, 10, true);
    const ctx = fake as unknown as CanvasRenderingContext2D;
    probeReadback(ctx, 10, 10);
    const data = fake.getImageData(9, 9, 1, 1).data;
    expect(Array.from(data)).toEqual([0, 0, 0, 0]);
  });

  it('restores a pixel already drawn at the probed corner rather than erasing it', () => {
    const fake = new FakeCtx(10, 10, true);
    fake.fillRect(9, 9, 1, 1); // a segment that happens to reach the far corner
    const before = Array.from(fake.getImageData(9, 9, 1, 1).data);

    probeReadback(fake as unknown as CanvasRenderingContext2D, 10, 10);

    expect(Array.from(fake.getImageData(9, 9, 1, 1).data)).toEqual(before);
  });

  it('still passes when the engine perturbs getImageData to defeat fingerprinting', () => {
    const fake = new FakeCtx(10, 10, true);
    const raw = fake.getImageData.bind(fake);
    fake.getImageData = (x: number, y: number, w: number, h: number): ImageData => {
      const image = raw(x, y, w, h);
      for (let i = 0; i < image.data.length; i++) {
        const v = image.data[i] as number;
        image.data[i] = v === 0 ? 3 : v - 5;
      }
      return image;
    };

    expect(probeReadback(fake as unknown as CanvasRenderingContext2D, 10, 10)).toBe(true);
  });

  it('does not touch pixels outside the probed corner, so it is safe to call on a layer that already holds drawn content', () => {
    const fake = new FakeCtx(10, 10, true);
    fake.fillRect(0, 0, 1, 1); // stand-in for a previously drawn segment
    const before = Array.from(fake.getImageData(0, 0, 1, 1).data);

    probeReadback(fake as unknown as CanvasRenderingContext2D, 10, 10);

    const after = Array.from(fake.getImageData(0, 0, 1, 1).data);
    expect(after).toEqual(before);
  });

  it('always pairs save with restore, even when getImageData throws', () => {
    let saveCalls = 0;
    let restoreCalls = 0;
    const ctx = {
      fillStyle: '',
      save(): void {
        saveCalls++;
      },
      restore(): void {
        restoreCalls++;
      },
      setTransform(): void {},
      clearRect(): void {},
      fillRect(): void {},
      getImageData(): never {
        throw new Error('tainted canvas');
      },
    } as unknown as CanvasRenderingContext2D;

    expect(probeReadback(ctx, 10, 10)).toBe(false);
    expect(saveCalls).toBe(1);
    expect(restoreCalls).toBe(1);
  });

  it('succeeds on a context the caller has already scaled, by resetting the transform before probing', () => {
    const fake = new FakeCtx(10, 10, true);
    fake.scale(3, 3); // simulate the animation layer's dpr pre-scale

    expect(probeReadback(fake as unknown as CanvasRenderingContext2D, 10, 10)).toBe(true);
  });

  it('restores the callers transform afterward rather than leaving it reset', () => {
    const fake = new FakeCtx(10, 10, true);
    fake.scale(3, 3);

    probeReadback(fake as unknown as CanvasRenderingContext2D, 10, 10);

    expect(fake.getTransform()).toEqual({ a: 3, d: 3, e: 0, f: 0 });
  });

  it('does not corrupt content drawn under a different transform than the one it probes with', () => {
    const fake = new FakeCtx(30, 30, true);
    fake.scale(3, 3);
    // A caller drawing at CSS-space (1, 1) through the dpr-3 transform lands
    // at raw device pixel (3, 3) — nowhere near the probed corner at (29, 29).
    fake.fillRect(1, 1, 1, 1);
    const before = Array.from(fake.getImageData(3, 3, 1, 1).data);

    probeReadback(fake as unknown as CanvasRenderingContext2D, 30, 30);

    const after = Array.from(fake.getImageData(3, 3, 1, 1).data);
    expect(after).toEqual(before);
  });
});

describe('createStaticLayer', () => {
  it('renders a fixture board at the requested resolution when it is under budget', () => {
    const board = ACYCLIC_BOARD; // 4x4
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: fakeCanvasFactory(1_000_000),
    });
    const paddedSide = 4 + 2 * ARROWHEAD_OVERHANG_CELLS;
    expect(layer.budget.degraded).toBe(false);
    expect(layer.budget.widthPx).toBe(Math.round(20 * paddedSide));
    expect(layer.budget.heightPx).toBe(Math.round(20 * paddedSide));
    expect(layer.viewport.scale).toBe(20);
    // The viewport maps cell -> buffer pixel, not cell -> CSS pixel: a
    // different space, tagged so it cannot be handed to a CSS-space consumer.
    expect(layer.viewport.space).toBe('buffer');
    expect(layer.allocationOk).toBe(true);
  });

  it('offsets the viewport origin by the arrowhead overhang, so cell 0 is not flush with the buffer edge', () => {
    const board = ACYCLIC_BOARD;
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: fakeCanvasFactory(1_000_000),
    });
    const expectedOrigin = ARROWHEAD_OVERHANG_CELLS * layer.viewport.scale;
    expect(layer.viewport.originX).toBe(expectedOrigin);
    expect(layer.viewport.originY).toBe(expectedOrigin);
  });

  it('pads the buffer enough that a border head arrowhead tip stays inside the canvas', () => {
    // A single segment whose head sits on the board's own top-left corner,
    // pointing further off-board (north): the worst case for clipping.
    const board = makeBoard({ art: 'A', dirs: { a: 'N' } });
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: fakeCanvasFactory(1_000_000),
    });
    const calls: { x: number; y: number }[] = [];
    const ctx = {
      fillStyle: '',
      beginPath(): void {},
      moveTo(x: number, y: number): void {
        calls.push({ x, y });
      },
      lineTo(x: number, y: number): void {
        calls.push({ x, y });
      },
      closePath(): void {},
      fill(): void {},
    };

    drawArrowhead(ctx, board, 1, layer.viewport);

    // Rounding the buffer to whole device pixels can leave a sub-pixel
    // epsilon outside [0, dim]; only a real clip (more than a pixel) matters.
    const epsilon = 1e-6;
    expect(calls.length).toBeGreaterThan(0);
    for (const { x, y } of calls) {
      expect(x).toBeGreaterThanOrEqual(-epsilon);
      expect(y).toBeGreaterThanOrEqual(-epsilon);
      expect(x).toBeLessThanOrEqual(layer.budget.widthPx + epsilon);
      expect(y).toBeLessThanOrEqual(layer.budget.heightPx + epsilon);
    }
  });

  it('exposes legibleUnzoomed as true at the resting CSS scale (0.95 cells * 10 px/cell = 9.5px, over the 9px floor)', () => {
    const board = ACYCLIC_BOARD;
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: fakeCanvasFactory(1_000_000),
    });
    expect(layer.legibleUnzoomed).toBe(true);
  });

  it('degrades resolution when the full-resolution canvas silently fails to allocate', () => {
    // 100 wide, 1 tall, one segment; only tiny allocations "succeed".
    const board = makeBoard({ art: `${'a'.repeat(99)}A`, params: { gridSize: 100 } });
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 300,
      createCanvas: fakeCanvasFactory(500),
      maxDimension: 8192,
    });
    expect(layer.budget.degraded).toBe(true);
    expect(layer.allocationOk).toBe(true);
    expect(layer.attempts.length).toBeGreaterThan(1);
    expect(probeReadback(layer.ctx, layer.budget.widthPx, layer.budget.heightPx)).toBe(true);
  });

  it('reports allocationOk false when no rung ever actually allocates', () => {
    const board = { width: 40, height: 40 } as unknown as Board;
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: fakeCanvasFactory(0),
    });
    expect(layer.allocationOk).toBe(false);
    expect(layer.attempts.every((a) => !a.ok)).toBe(true);
  });

  it('is capped at 8192 device pixels per side by default', () => {
    const board = { width: 100, height: 100 } as unknown as Board;
    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 300,
      createCanvas: fakeCanvasFactory(100_000_000),
    });
    expect(layer.budget.widthPx).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    expect(layer.budget.heightPx).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });

  it('without an explicit request, sizes to what the board needs rather than the cap', () => {
    const board = { width: 20, height: 20 } as unknown as Board;
    const layer = createStaticLayer(board, {
      dpr: 1,
      createCanvas: fakeCanvasFactory(100_000_000),
    });
    // 20 cells, padded by the arrowhead overhang, at 10 base * 3 maxZoom * 1 dpr.
    const expectedWidthPx = Math.round((20 + 2 * ARROWHEAD_OVERHANG_CELLS) * 30);
    expect(layer.budget.degraded).toBe(false);
    expect(layer.budget.widthPx).toBe(expectedWidthPx);
    expect(layer.budget.widthPx).toBeLessThan(MAX_CANVAS_DIMENSION);
  });

  it('without an explicit request at dpr 3 on a 100x100 board, matches the spike-measured cap', () => {
    const board = { width: 100, height: 100 } as unknown as Board;
    const layer = createStaticLayer(board, {
      dpr: 3,
      createCanvas: fakeCanvasFactory(100_000_000),
    });
    const expectedPixelsPerCell = MAX_CANVAS_DIMENSION / (100 + 2 * ARROWHEAD_OVERHANG_CELLS);
    expect(layer.budget.degraded).toBe(true);
    expect(layer.budget.pixelsPerCell).toBeCloseTo(expectedPixelsPerCell, 6);
  });

  it('reports allocationOk false when the final re-allocation silently fails', () => {
    const board = { width: 20, height: 20 } as unknown as Board;
    // The ladder's probe succeeds, then the surface degrades under it: the
    // re-allocation at the very same budget comes back blank. Trusting the
    // ladder's verdict alone would report a working buffer.
    let allocations = 0;
    const createCanvas = (): CanvasLike => {
      const canvas = {
        width: 0,
        height: 0,
        getContext(id: '2d') {
          if (id !== '2d') return null;
          allocations++;
          return new FakeCtx(
            canvas.width,
            canvas.height,
            allocations === 1,
          ) as unknown as CanvasRenderingContext2D;
        },
      };
      return canvas;
    };

    const layer = createStaticLayer(board, { dpr: 1, createCanvas });
    expect(layer.allocationOk).toBe(false);
  });

  it('degrades instead of throwing when resizing an over-budget canvas throws outright', () => {
    const board = { width: 40, height: 40 } as unknown as Board;
    // 20px/cell, 10, 5, 2.5 and 1.25 all resize to an area over this; the
    // floor rung (1px/cell, padded by the arrowhead overhang) is the first
    // that fits.
    const throwAbovePx = 2000;
    const canvas: CanvasLike & { widthValue: number; heightValue: number } = {
      widthValue: 0,
      heightValue: 0,
      get width() {
        return this.widthValue;
      },
      set width(value: number) {
        if (value * this.heightValue > throwAbovePx) throw new Error('allocation failed');
        this.widthValue = value;
      },
      get height() {
        return this.heightValue;
      },
      set height(value: number) {
        if (this.widthValue * value > throwAbovePx) throw new Error('allocation failed');
        this.heightValue = value;
      },
      getContext(id: '2d') {
        if (id !== '2d') return null;
        return new FakeCtx(
          this.widthValue,
          this.heightValue,
          true,
        ) as unknown as CanvasRenderingContext2D;
      },
    };

    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: () => canvas,
    });

    expect(layer.budget.widthPx * layer.budget.heightPx).toBeLessThanOrEqual(throwAbovePx);
    expect(layer.allocationOk).toBe(true);
  });

  it('always re-allocates at the final budget, so the canvas matches it even when the ladder left a stale, differently-sized context live', () => {
    const board = { width: 40, height: 40 } as unknown as Board;
    // Readback never succeeds, so the ladder degrades all the way to the
    // floor (1px/cell, padded by the arrowhead overhang). Resizing to the
    // floor width fails transiently — once — during the ladder's own probe,
    // leaving a larger, differently-sized context live; the unconditional
    // final re-allocate must retry and succeed.
    const floorWidth = Math.round(1 * (40 + 2 * ARROWHEAD_OVERHANG_CELLS));
    let floorResizeAttempts = 0;
    const canvas: CanvasLike & { widthValue: number; heightValue: number } = {
      widthValue: 0,
      heightValue: 0,
      get width() {
        return this.widthValue;
      },
      set width(value: number) {
        if (value === floorWidth) {
          floorResizeAttempts++;
          if (floorResizeAttempts === 1) throw new Error('transient allocation failure');
        }
        this.widthValue = value;
      },
      get height() {
        return this.heightValue;
      },
      set height(value: number) {
        this.heightValue = value;
      },
      getContext(id: '2d') {
        if (id !== '2d') return null;
        // allocated: false, so probeReadback always reports failure and the
        // ladder runs all the way to the floor.
        return new FakeCtx(
          this.widthValue,
          this.heightValue,
          false,
        ) as unknown as CanvasRenderingContext2D;
      },
    };

    const layer = createStaticLayer(board, {
      requestedPixelsPerCell: 20,
      createCanvas: () => canvas,
    });

    expect(layer.budget.widthPx).toBe(floorWidth);
    expect(layer.budget.heightPx).toBe(floorWidth);
    expect(layer.canvas.width).toBe(layer.budget.widthPx);
    expect(layer.canvas.height).toBe(layer.budget.heightPx);
  });
});

describe('redrawStaticLayer', () => {
  it('draws every segment not in the removed set, one moveTo for the body and one for its arrowhead', () => {
    const board = ACYCLIC_BOARD; // 3 segments
    let clears = 0;
    let moveToCount = 0;
    const canvas: CanvasLike = {
      width: 80,
      height: 80,
      getContext: () =>
        ({
          clearRect(): void {
            clears++;
          },
          strokeStyle: '',
          fillStyle: '',
          lineWidth: 0,
          lineJoin: 'miter' as CanvasLineJoin,
          lineCap: 'butt' as CanvasLineCap,
          beginPath(): void {},
          moveTo(): void {
            moveToCount++;
          },
          lineTo(): void {},
          stroke(): void {},
          closePath(): void {},
          fill(): void {},
        }) as unknown as CanvasRenderingContext2D,
    };
    const layer = {
      canvas,
      ctx: canvas.getContext('2d')!,
      budget: { pixelsPerCell: 20, widthPx: 80, heightPx: 80, degraded: false },
      viewport: createBufferViewport(20),
      allocationOk: true,
      attempts: [],
      legibleUnzoomed: true,
    };

    redrawStaticLayer(layer, board, new Set());
    expect(clears).toBe(1);
    expect(moveToCount).toBe(3 * 2);

    redrawStaticLayer(layer, board, new Set([1]));
    expect(clears).toBe(2);
    expect(moveToCount).toBe(3 * 2 + 2 * 2);
  });

  it('draws the rest of the board when one segment has malformed data', () => {
    const board = ACYCLIC_BOARD; // 3 segments
    const originalDir = board.segDir[0];
    board.segDir[0] = 255; // segment 1's body still strokes; its arrowhead cannot
    let moveToCount = 0;
    const canvas: CanvasLike = {
      width: 80,
      height: 80,
      getContext: () =>
        ({
          clearRect(): void {},
          strokeStyle: '',
          fillStyle: '',
          lineWidth: 0,
          lineJoin: 'miter' as CanvasLineJoin,
          lineCap: 'butt' as CanvasLineCap,
          beginPath(): void {},
          moveTo(): void {
            moveToCount++;
          },
          lineTo(): void {},
          stroke(): void {},
          closePath(): void {},
          fill(): void {},
        }) as unknown as CanvasRenderingContext2D,
    };
    const layer = {
      canvas,
      ctx: canvas.getContext('2d')!,
      budget: { pixelsPerCell: 20, widthPx: 80, heightPx: 80, degraded: false },
      viewport: createBufferViewport(20),
      allocationOk: true,
      attempts: [],
      legibleUnzoomed: true,
    };

    try {
      expect(() => redrawStaticLayer(layer, board, new Set())).not.toThrow();
      // 3 segments * 2 moveTo (body + arrowhead) each, minus segment 1's arrowhead.
      expect(moveToCount).toBe(3 * 2 - 1);
    } finally {
      board.segDir[0] = originalDir as number;
    }
  });

  it('does not swallow a failure that is not malformed segment data', () => {
    const board = ACYCLIC_BOARD;
    const canvas: CanvasLike = {
      width: 80,
      height: 80,
      getContext: () =>
        ({
          clearRect(): void {},
          strokeStyle: '',
          fillStyle: '',
          lineWidth: 0,
          lineJoin: 'miter' as CanvasLineJoin,
          lineCap: 'butt' as CanvasLineCap,
          beginPath(): void {},
          moveTo(): void {},
          lineTo(): void {},
          stroke(): void {
            throw new Error('context is lost');
          },
          closePath(): void {},
          fill(): void {},
        }) as unknown as CanvasRenderingContext2D,
    };
    const layer = {
      canvas,
      ctx: canvas.getContext('2d')!,
      budget: { pixelsPerCell: 20, widthPx: 80, heightPx: 80, degraded: false },
      viewport: createBufferViewport(20),
      allocationOk: true,
      attempts: [],
      legibleUnzoomed: true,
    };

    expect(() => redrawStaticLayer(layer, board, new Set())).toThrow('context is lost');
  });
});

describe('createAnimationLayer / clearAnimationLayer', () => {
  it('is a 1:1 backing store at dpr 1 and does not rescale the context', () => {
    const layer = createAnimationLayer(390, 844, 1, fakeCanvasFactory(10_000_000));
    expect(layer.canvas.width).toBe(390);
    expect(layer.canvas.height).toBe(844);
    expect(layer.cssWidth).toBe(390);
    expect(layer.cssHeight).toBe(844);
    expect(layer.dpr).toBe(1);
    expect((layer.ctx as unknown as FakeCtx).scaleCalls).toEqual([[1, 1]]);
  });

  it('scales the backing store to device pixels and pre-scales the context by dpr, so a caller keeps drawing in CSS pixels', () => {
    const layer = createAnimationLayer(390, 844, 3, fakeCanvasFactory(10_000_000));
    expect(layer.canvas.width).toBe(1170);
    expect(layer.canvas.height).toBe(2532);
    expect(layer.cssWidth).toBe(390);
    expect(layer.cssHeight).toBe(844);
    expect(layer.dpr).toBe(3);
    expect((layer.ctx as unknown as FakeCtx).scaleCalls).toEqual([[3, 3]]);
  });

  it('clears the actual backing-store dimensions, not cssWidth * dpr, resetting the transform first', () => {
    let createdCtx: FakeCtx | undefined;
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext(id: '2d') {
        if (id !== '2d') return null;
        createdCtx = new FakeCtx(this.width, this.height, true);
        return createdCtx as unknown as CanvasRenderingContext2D;
      },
    };
    const layer = createAnimationLayer(100, 200, 3, () => canvas);
    const ctx = createdCtx as unknown as FakeCtx;
    ctx.pokeRawPixel(layer.canvas.width - 1, layer.canvas.height - 1, [1, 2, 3, 4]);

    clearAnimationLayer(layer);

    expect(
      Array.from(ctx.getImageData(layer.canvas.width - 1, layer.canvas.height - 1, 1, 1).data),
    ).toEqual([0, 0, 0, 0]);
    // The dpr pre-scale is restored afterward, not left reset.
    expect(ctx.getTransform()).toEqual({ a: 3, d: 3, e: 0, f: 0 });
  });

  it('clears the full backing store even when cssWidth * dpr rounds unevenly into it', () => {
    const dpr = 2;
    const cssWidth = 411.8; // cssWidth * dpr = 823.6; the backing store rounds up to 824.
    let createdCtx: FakeCtx | undefined;
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext(id: '2d') {
        if (id !== '2d') return null;
        createdCtx = new FakeCtx(this.width, this.height, true);
        return createdCtx as unknown as CanvasRenderingContext2D;
      },
    };
    const layer = createAnimationLayer(cssWidth, 10, dpr, () => canvas);
    expect(layer.canvas.width).toBe(824);

    const ctx = createdCtx as unknown as FakeCtx;
    // The far column a CSS-space clearRect(0, 0, cssWidth, cssHeight) would
    // miss: it only reaches raw x = 823.6 through the dpr-2 transform.
    ctx.pokeRawPixel(823, 0, [1, 2, 3, 4]);

    clearAnimationLayer(layer);

    expect(Array.from(ctx.getImageData(823, 0, 1, 1).data)).toEqual([0, 0, 0, 0]);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a cssWidth of %p', (bad) => {
    expect(() => createAnimationLayer(bad, 100, 1, fakeCanvasFactory(1_000_000))).toThrow(
      RangeError,
    );
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects a cssHeight of %p', (bad) => {
    expect(() => createAnimationLayer(100, bad, 1, fakeCanvasFactory(1_000_000))).toThrow(
      RangeError,
    );
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])(
    'rejects a dpr of %p rather than silently sizing a 0x0 canvas',
    (bad) => {
      expect(() => createAnimationLayer(390, 844, bad, fakeCanvasFactory(1_000_000))).toThrow(
        RangeError,
      );
    },
  );
});
