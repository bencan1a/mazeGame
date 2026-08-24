/**
 * Headless game state machine: removed-set, lives, tap queue, win/lose/restart.
 *
 * `Board` is never mutated. Removal is tracked here as a `removed` bitset
 * (1-based, index 0 unused, same convention as `occupancy`) plus an
 * incremental count so win detection is O(1) rather than a scan.
 */

import type { Board, PlayParams, SegmentId } from '../core/types.js';

/** A queued tap: a resolved segment id, or `null` for a miss (nothing in radius). */
export type TapInput = SegmentId | null;

export type TapOutcome =
  | { readonly kind: 'removed'; readonly id: SegmentId }
  | { readonly kind: 'bounced'; readonly id: SegmentId; readonly livesRemaining: number }
  | { readonly kind: 'miss' };

export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameState {
  readonly board: Board;
  readonly playParams: PlayParams;
  /** `removed[id] === 1` means segment `id` has left the board. Length segmentCount + 1. */
  readonly removed: Uint8Array;
  readonly removedCount: number;
  readonly lives: number;
  /** Taps not yet resolved, oldest first. */
  readonly queue: readonly TapInput[];
  /** True while a removal or bounce animation is in flight; the queue waits for it. */
  readonly animating: boolean;
  readonly status: GameStatus;
  /** Result of the most recently resolved tap, for a caller deciding what to animate. */
  readonly lastOutcome: TapOutcome | null;
}

const MISS_OUTCOME: TapOutcome = { kind: 'miss' };

/** A fresh game on `board`, no segments removed, full lives, empty queue. */
export function createGameState(board: Board, playParams: PlayParams): GameState {
  return {
    board,
    playParams,
    removed: new Uint8Array(board.segmentCount + 1),
    removedCount: 0,
    lives: playParams.lives,
    queue: [],
    animating: false,
    status: 'playing',
    lastOutcome: null,
  };
}

/**
 * True when segment `id` is not yet removed and every segment its ray is
 * blocked by has already been removed. Reads the CSR blocking digraph
 * directly: O(out-degree), not a ray walk.
 */
export function isFree(state: GameState, id: SegmentId): boolean {
  if (state.removed[id] === 1) return false;
  const { board, removed } = state;
  const start = board.edgeStart[id - 1] as number;
  const end = board.edgeStart[id] as number;
  for (let k = start; k < end; k++) {
    const target = board.edgeTarget[k] as number;
    if (removed[target] !== 1) return false;
  }
  return true;
}

export function isRemoved(state: GameState, id: SegmentId): boolean {
  return state.removed[id] === 1;
}

/**
 * Enqueue a tap and resolve as much of the queue as can resolve immediately.
 * Ignored once the game has left `'playing'` — call `restart` first.
 */
export function tap(state: GameState, input: TapInput): GameState {
  if (state.status !== 'playing') return state;
  return processQueue({ ...state, queue: [...state.queue, input] });
}

/**
 * Signals that the animation for the last resolved tap has finished. Advances
 * the queue by resolving the next tap, if any.
 */
export function animationComplete(state: GameState): GameState {
  if (!state.animating) return state;
  return processQueue({ ...state, animating: false });
}

/**
 * Drops the removed-set and restores full lives on the same `board` object.
 * Works from any status, including mid-animation with a non-empty queue, so a
 * caller that never gets its `animationComplete` signal — a cancelled
 * animation loop, an unmounted renderer — still has a way back to a fresh,
 * playable state.
 */
export function restart(state: GameState): GameState {
  return createGameState(state.board, state.playParams);
}

function processQueue(state: GameState): GameState {
  let current = state;
  while (current.status === 'playing' && !current.animating && current.queue.length > 0) {
    const input = current.queue[0] as TapInput;
    const rest = current.queue.slice(1);
    current = resolveOne({ ...current, queue: rest }, input);
  }
  return current;
}

function resolveOne(state: GameState, input: TapInput): GameState {
  if (
    input === null ||
    input < 1 ||
    input > state.board.segmentCount ||
    state.removed[input] === 1
  ) {
    return { ...state, lastOutcome: MISS_OUTCOME };
  }

  const id = input;
  if (isFree(state, id)) {
    const removed = state.removed.slice();
    removed[id] = 1;
    const removedCount = state.removedCount + 1;
    const won = removedCount === state.board.segmentCount;
    return {
      ...state,
      removed,
      removedCount,
      animating: true,
      status: won ? 'won' : state.status,
      lastOutcome: { kind: 'removed', id },
    };
  }

  const lives = Math.max(state.lives - 1, 0);
  return {
    ...state,
    lives,
    animating: true,
    status: lives === 0 ? 'lost' : state.status,
    lastOutcome: { kind: 'bounced', id, livesRemaining: lives },
  };
}
