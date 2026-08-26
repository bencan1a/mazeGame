import { describe, expect, it } from 'vitest';
import {
  INTRO_START_ZOOM,
  introCamera,
  introEase,
  revealedSegmentCount,
  startIntroAnimation,
  type IntroFrame,
} from './intro.js';
import type { SnakeOutScheduler } from './animate.js';
import { clampPan, createViewport, type PanBounds } from './viewport.js';
import { ACYCLIC_BOARD, makeBoard } from '../../test/fixtures/board.js';
import type { Board } from '../core/types.js';

/** As `fakeScheduler` in animate.test.ts: the test drives the clock and every callback. */
function fakeScheduler(): SnakeOutScheduler & {
  clock: { value: number };
  frames: Map<number, (time: number) => void>;
  fireVisible(): void;
} {
  let nextId = 1;
  const frames = new Map<number, (time: number) => void>();
  const visibleSubscribers = new Set<() => void>();
  const clock = { value: 0 };
  return {
    clock,
    frames,
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

function runQueuedFrames(scheduler: ReturnType<typeof fakeScheduler>): void {
  const due = [...scheduler.frames.entries()].sort((a, b) => a[0] - b[0]);
  for (const [id, callback] of due) {
    scheduler.frames.delete(id);
    callback(scheduler.clock.value);
  }
}

describe('introEase', () => {
  it('starts at rest, ends at rest, and passes through the midpoint', () => {
    expect(introEase(0)).toBe(0);
    expect(introEase(1)).toBe(1);
    expect(introEase(0.5)).toBeCloseTo(0.5, 12);
  });

  it('never goes backwards', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const value = introEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('holds the opening view through the first tenth rather than leaving it at once', () => {
    expect(introEase(0.1)).toBeLessThan(0.1);
  });

  it('treats a progress outside [0, 1] — or no reading at all — as an end of the range', () => {
    expect(introEase(-2)).toBe(0);
    expect(introEase(4)).toBe(1);
    expect(introEase(NaN)).toBe(0);
  });
});

describe('revealedSegmentCount', () => {
  // ACYCLIC_BOARD: segment 1 is 5 cells, 2 is 5, 3 is 6, 16 in all.
  const board = ACYCLIC_BOARD;

  it('reveals nothing at the start and everything at the end', () => {
    expect(revealedSegmentCount(board, 0)).toBe(0);
    expect(revealedSegmentCount(board, 1)).toBe(board.segmentCount);
  });

  it('counts cells rather than segments, so a long segment takes proportionally longer', () => {
    expect(revealedSegmentCount(board, 4 / 16)).toBe(0);
    expect(revealedSegmentCount(board, 5 / 16)).toBe(1);
    expect(revealedSegmentCount(board, 9 / 16)).toBe(1);
    expect(revealedSegmentCount(board, 10 / 16)).toBe(2);
    expect(revealedSegmentCount(board, 15 / 16)).toBe(2);
  });

  it('never goes backwards', () => {
    let previous = 0;
    for (let i = 0; i <= 200; i++) {
      const count = revealedSegmentCount(board, i / 200);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('clamps a progress outside [0, 1] rather than reading off the end of the CSR', () => {
    expect(revealedSegmentCount(board, -1)).toBe(0);
    expect(revealedSegmentCount(board, 9)).toBe(board.segmentCount);
    expect(revealedSegmentCount(board, NaN)).toBe(0);
  });

  it('has nothing to reveal on a board with no segments', () => {
    const empty = {
      width: 4,
      height: 4,
      segmentCount: 0,
      segStart: Uint32Array.from([0]),
      segCells: new Uint32Array(0),
    } as unknown as Board;
    expect(revealedSegmentCount(empty, 0.5)).toBe(0);
  });
});

describe('introCamera', () => {
  // A 4x4 board on a 400x400 canvas fits at 100 CSS px per cell.
  const board = ACYCLIC_BOARD;
  const bounds: PanBounds = {
    boardWidth: board.width,
    boardHeight: board.height,
    canvasCssWidth: 400,
    canvasCssHeight: 400,
  };
  const resting = clampPan(createViewport({ scale: 100, dpr: 2 }), bounds);
  const startScale = 100 * INTRO_START_ZOOM;

  it('opens zoomed in on the middle of the board', () => {
    const opened = introCamera({ resting, startScale, progress: 0, bounds });
    expect(opened.scale).toBe(startScale);
    // 4 cells at 250 px is 1000 px of board against a 400 px canvas.
    expect(opened.originX).toBeCloseTo(-300, 10);
    expect(opened.originY).toBeCloseTo(-300, 10);
  });

  it('lands exactly on the resting viewport, so nothing jumps as it ends', () => {
    expect(introCamera({ resting, startScale, progress: 1, bounds })).toEqual(resting);
  });

  it('holds the board centre under the canvas centre the whole way, so nothing pans', () => {
    for (let i = 0; i <= 20; i++) {
      const frame = introCamera({ resting, startScale, progress: i / 20, bounds });
      expect(frame.originX + (board.width * frame.scale) / 2).toBeCloseTo(
        bounds.canvasCssWidth / 2,
        10,
      );
      expect(frame.originY + (board.height * frame.scale) / 2).toBeCloseTo(
        bounds.canvasCssHeight / 2,
        10,
      );
    }
  });

  it('pulls back monotonically', () => {
    let previous = Infinity;
    for (let i = 0; i <= 50; i++) {
      const { scale } = introCamera({ resting, startScale, progress: i / 50, bounds });
      expect(scale).toBeLessThanOrEqual(previous);
      previous = scale;
    }
    expect(previous).toBe(resting.scale);
  });

  it('carries the resting dpr, since the camera only moves the sampled rectangle', () => {
    const mid = introCamera({ resting, startScale, progress: 0.5, bounds });
    expect(mid.dpr).toBe(resting.dpr);
    expect(mid.space).toBe('css');
  });

  it('falls back to the resting viewport rather than a viewport it cannot build', () => {
    expect(introCamera({ resting, startScale: NaN, progress: 0.5, bounds })).toEqual(resting);
  });
});

describe('startIntroAnimation', () => {
  const board = ACYCLIC_BOARD;

  it('rejects a duration the caller got wrong', () => {
    const scheduler = fakeScheduler();
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() =>
        startIntroAnimation({
          board,
          durationMs: bad,
          scheduler,
          onFrame: () => {},
          onComplete: () => {},
        }),
      ).toThrow(RangeError);
    }
  });

  it('paints the opening frame before returning, so no un-revealed board is shown', () => {
    const scheduler = fakeScheduler();
    const frames: IntroFrame[] = [];
    startIntroAnimation({
      board,
      durationMs: 1000,
      scheduler,
      onFrame: (frame) => frames.push(frame),
      onComplete: () => {},
    });
    expect(frames).toEqual([{ progress: 0, revealedCount: 0 }]);
  });

  it('reveals more on every frame and completes once, on a full-board frame', () => {
    const scheduler = fakeScheduler();
    const frames: IntroFrame[] = [];
    let completions = 0;
    startIntroAnimation({
      board,
      durationMs: 1000,
      scheduler,
      onFrame: (frame) => frames.push(frame),
      onComplete: () => {
        completions++;
      },
    });

    for (const time of [200, 400, 700, 1000, 1200]) {
      scheduler.clock.value = time;
      runQueuedFrames(scheduler);
    }

    expect(completions).toBe(1);
    const last = frames[frames.length - 1];
    expect(last).toEqual({ progress: 1, revealedCount: board.segmentCount });
    for (let i = 1; i < frames.length; i++) {
      expect((frames[i] as IntroFrame).revealedCount).toBeGreaterThanOrEqual(
        (frames[i - 1] as IntroFrame).revealedCount,
      );
      expect((frames[i] as IntroFrame).progress).toBeGreaterThan(
        (frames[i - 1] as IntroFrame).progress,
      );
    }
    expect(scheduler.frames.size).toBe(0);
  });

  it('finishes on demand with the whole board drawn, and only once', () => {
    const scheduler = fakeScheduler();
    const frames: IntroFrame[] = [];
    let completions = 0;
    const animation = startIntroAnimation({
      board,
      durationMs: 1000,
      scheduler,
      onFrame: (frame) => frames.push(frame),
      onComplete: () => {
        completions++;
      },
    });

    animation.finish();
    animation.finish();
    scheduler.clock.value = 500;
    runQueuedFrames(scheduler);

    expect(completions).toBe(1);
    expect(frames[frames.length - 1]).toEqual({ progress: 1, revealedCount: board.segmentCount });
    expect(scheduler.frames.size).toBe(0);
  });

  it('stops on cancel without a final frame and without completing', () => {
    const scheduler = fakeScheduler();
    const frames: IntroFrame[] = [];
    let completions = 0;
    const animation = startIntroAnimation({
      board,
      durationMs: 1000,
      scheduler,
      onFrame: (frame) => frames.push(frame),
      onComplete: () => {
        completions++;
      },
    });

    animation.cancel();
    animation.cancel();
    scheduler.clock.value = 2000;
    runQueuedFrames(scheduler);
    scheduler.fireVisible();

    expect(completions).toBe(0);
    expect(frames).toHaveLength(1);
    expect(scheduler.frames.size).toBe(0);
  });

  it('completes on the tab coming back, where frames stopped arriving mid-reveal', () => {
    const scheduler = fakeScheduler();
    let completions = 0;
    startIntroAnimation({
      board,
      durationMs: 1000,
      scheduler,
      onFrame: () => {},
      onComplete: () => {
        completions++;
      },
    });

    scheduler.clock.value = 400;
    scheduler.fireVisible();
    expect(completions).toBe(0);

    scheduler.clock.value = 1400;
    scheduler.fireVisible();
    expect(completions).toBe(1);
  });

  it('hands the board back when a frame throws, rather than stranding it part drawn', () => {
    const scheduler = fakeScheduler();
    let completions = 0;
    let calls = 0;
    startIntroAnimation({
      board,
      durationMs: 1000,
      scheduler,
      onFrame: () => {
        calls++;
        throw new Error('canvas went away');
      },
      onComplete: () => {
        completions++;
      },
    });

    expect(calls).toBe(1);
    expect(completions).toBe(0);

    scheduler.clock.value = 100;
    runQueuedFrames(scheduler);

    expect(completions).toBe(1);
    expect(scheduler.frames.size).toBe(0);
  });

  it('reveals a one-segment board in a single step', () => {
    const scheduler = fakeScheduler();
    const board1 = makeBoard(['aA'].join('\n'));
    const frames: IntroFrame[] = [];
    startIntroAnimation({
      board: board1,
      durationMs: 100,
      scheduler,
      onFrame: (frame) => frames.push(frame),
      onComplete: () => {},
    });
    scheduler.clock.value = 100;
    runQueuedFrames(scheduler);
    expect(frames[frames.length - 1]).toEqual({ progress: 1, revealedCount: 1 });
  });
});
