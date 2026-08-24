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
  redrawStaticLayer,
  removedSetsDiffer,
  type CanvasLike,
} from './layers.js';
import { ACYCLIC_BOARD, makeBoard } from '../../test/fixtures/board.js';
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
});

describe('planDegradation', () => {
  it('accepts the first attempt when the probe succeeds immediately', () => {
    const plan = planDegradation(40, 40, 20, () => true);
    expect(plan.attempts).toHaveLength(1);
    expect(plan.budget.pixelsPerCell).toBe(20);
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
  });

  it('gives up gracefully at the floor rather than looping forever', () => {
    const plan = planDegradation(40, 40, 20, () => false, { minPixelsPerCell: 2 });
    expect(plan.budget.pixelsPerCell).toBe(2);
    expect(plan.attempts.every((a) => !a.ok)).toBe(true);
    expect(plan.attempts.length).toBeGreaterThan(1);
  });

  it('respects a custom max dimension', () => {
    const plan = planDegradation(100, 100, 300, () => true, { maxDimension: 1024 });
    expect(plan.budget.widthPx).toBeLessThanOrEqual(1024);
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

/** A minimal 2D-context fake with a device memory cap, to exercise the readback probe without a real canvas. */
class FakeCtx {
  private pixels: Uint8ClampedArray;
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly allocated: boolean,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  fillStyle = '';
  save(): void {}
  restore(): void {}
  clearRect(): void {}
  fillRect(x: number, y: number, w: number, h: number): void {
    if (!this.allocated) return;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
        const i = (py * this.width + px) * 4;
        this.pixels[i] = 255;
        this.pixels[i + 1] = 0;
        this.pixels[i + 2] = 255;
        this.pixels[i + 3] = 255;
      }
    }
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
  // The rest of strokeSegmentPolyline's minimal surface.
  strokeStyle = '';
  lineWidth = 0;
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
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
});

describe('createStaticLayer', () => {
  it('renders a fixture board at the requested resolution when it is under budget', () => {
    const board = ACYCLIC_BOARD; // 4x4
    const layer = createStaticLayer(board, 20, { createCanvas: fakeCanvasFactory(1_000_000) });
    expect(layer.budget.degraded).toBe(false);
    expect(layer.budget.widthPx).toBe(80);
    expect(layer.budget.heightPx).toBe(80);
    expect(layer.viewport.scale).toBe(20);
  });

  it('degrades resolution when the full-resolution canvas silently fails to allocate', () => {
    // 100 wide, 1 tall, one segment; only tiny allocations "succeed".
    const board = makeBoard({ art: `${'a'.repeat(99)}A`, params: { gridSize: 100 } });
    const layer = createStaticLayer(board, 300, {
      createCanvas: fakeCanvasFactory(500),
      maxDimension: 8192,
    });
    expect(layer.budget.degraded).toBe(true);
    expect(probeReadback(layer.ctx, layer.budget.widthPx, layer.budget.heightPx)).toBe(true);
  });

  it('is capped at 8192 device pixels per side by default', () => {
    const board = { width: 100, height: 100 } as unknown as Board;
    const layer = createStaticLayer(board, 300, { createCanvas: fakeCanvasFactory(100_000_000) });
    expect(layer.budget.widthPx).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    expect(layer.budget.heightPx).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
  });
});

describe('redrawStaticLayer', () => {
  it('draws every segment not in the removed set, one moveTo per segment', () => {
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
          lineWidth: 0,
          lineJoin: 'miter' as CanvasLineJoin,
          lineCap: 'butt' as CanvasLineCap,
          beginPath(): void {},
          moveTo(): void {
            moveToCount++;
          },
          lineTo(): void {},
          stroke(): void {},
        }) as unknown as CanvasRenderingContext2D,
    };
    const layer = {
      canvas,
      ctx: canvas.getContext('2d')!,
      budget: { pixelsPerCell: 20, widthPx: 80, heightPx: 80, degraded: false },
      viewport: { scale: 20, dpr: 1, originX: 0, originY: 0 },
    };

    redrawStaticLayer(layer, board, new Set());
    expect(clears).toBe(1);
    expect(moveToCount).toBe(3);

    redrawStaticLayer(layer, board, new Set([1]));
    expect(clears).toBe(2);
    expect(moveToCount).toBe(3 + 2);
  });
});

describe('createAnimationLayer / clearAnimationLayer', () => {
  it('sizes the canvas to the requested screen dimensions', () => {
    const layer = createAnimationLayer(390, 844, fakeCanvasFactory(10_000_000));
    expect(layer.canvas.width).toBe(390);
    expect(layer.canvas.height).toBe(844);
  });

  it('clears the full backing store', () => {
    let cleared: [number, number, number, number] | undefined;
    const canvas: CanvasLike = {
      width: 100,
      height: 200,
      getContext: () =>
        ({
          clearRect: (x: number, y: number, w: number, h: number) => {
            cleared = [x, y, w, h];
          },
        }) as unknown as CanvasRenderingContext2D,
    };
    const layer = { canvas, ctx: canvas.getContext('2d')! };
    clearAnimationLayer(layer);
    expect(cleared).toEqual([0, 0, 100, 200]);
  });
});
