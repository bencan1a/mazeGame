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

/**
 * A fresh game on `board`, no segments removed, empty queue. Lives start at
 * `playParams.lives`; a non-positive value starts already `'lost'`, since the
 * terminal condition is otherwise only checked after a decrement.
 */
export function createGameState(board: Board, playParams: PlayParams): GameState {
  const lives = playParams.lives;
  return {
    board,
    playParams,
    removed: new Uint8Array(board.segmentCount + 1),
    removedCount: 0,
    lives,
    queue: [],
    animating: false,
    status: lives <= 0 ? 'lost' : 'playing',
    lastOutcome: null,
  };
}

/**
 * True when `id` is a valid, not-yet-removed segment and every segment its
 * ray is blocked by has already been removed. Reads the CSR blocking digraph
 * directly: O(out-degree), not a ray walk.
 *
 * Validates `id` itself rather than trusting the caller: this is the
 * predicate a tap-radius search injects, and it is handed whatever a hit
 * test read out of `occupancy`, including the reserved empty-cell value 0.
 */
export function isFree(state: GameState, id: SegmentId): boolean {
  if (!isValidSegmentId(state.board, id)) return false;
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

/** A segment id is an integer in `1..segmentCount`; `Number.isInteger` also excludes `NaN`. */
function isValidSegmentId(board: Board, id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= board.segmentCount;
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
 * The part of a game that a regenerated board cannot reproduce by itself.
 *
 * A board is a pure function of `(seed, params)`, so what has to be carried
 * across a reload is which segments have left and how many lives are left —
 * not the board. The queue and the animation flag are deliberately absent:
 * both describe a moment mid-flight, and a restore lands on a settled game.
 */
export interface GameSnapshot {
  readonly removedSegments: readonly SegmentId[];
  readonly lives: number;
}

/** Ids in ascending order, so two snapshots of the same game serialise alike. */
export function snapshotGameState(state: GameState): GameSnapshot {
  const removedSegments: SegmentId[] = [];
  for (let id = 1; id <= state.board.segmentCount; id++) {
    if (state.removed[id] === 1) removedSegments.push(id);
  }
  return { removedSegments, lives: state.lives };
}

/**
 * Rebuilds the state a snapshot describes on `board`, settled: empty queue,
 * nothing animating, no last outcome.
 *
 * Throws when the snapshot cannot describe a game on this board. A restore
 * that quietly dropped an out-of-range id would resume a *different* game
 * under the same seed — fewer segments removed, with nothing to show for it —
 * so the caller gets the chance to fall back to a fresh board instead. A
 * repeated id is not that case: it states the same fact twice, and counts
 * once.
 */
export function restoreGameState(
  board: Board,
  playParams: PlayParams,
  snapshot: GameSnapshot,
): GameState {
  const { lives } = snapshot;
  if (!Number.isInteger(lives) || lives < 0) {
    throw new RangeError(`restoreGameState: lives must be a non-negative integer, got ${lives}`);
  }
  if (lives > playParams.lives) {
    throw new RangeError(
      `restoreGameState: ${lives} lives on a game that starts with ${playParams.lives}; ` +
        'lives only ever decrement, so no play reaches this',
    );
  }

  const removed = new Uint8Array(board.segmentCount + 1);
  let removedCount = 0;
  for (const id of snapshot.removedSegments) {
    if (!isValidSegmentId(board, id)) {
      throw new RangeError(
        `restoreGameState: segment ${id} is not on a board of ${board.segmentCount} segments`,
      );
    }
    if (removed[id] === 1) continue;
    removed[id] = 1;
    removedCount++;
  }

  return {
    board,
    playParams,
    removed,
    removedCount,
    lives,
    queue: [],
    animating: false,
    status: statusFor(lives, removedCount, board.segmentCount),
    lastOutcome: null,
  };
}

/**
 * Zero lives loses whatever else is true: `resolveOne` decrements only on a
 * bounce, and `tap` ignores everything once the status has left `'playing'`,
 * so a board cannot have been cleared after the last life went.
 */
function statusFor(lives: number, removedCount: number, segmentCount: number): GameStatus {
  if (lives <= 0) return 'lost';
  return removedCount === segmentCount ? 'won' : 'playing';
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
  if (input === null || !isValidSegmentId(state.board, input) || state.removed[input] === 1) {
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
