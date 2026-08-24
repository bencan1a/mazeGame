import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_PLAY_PARAMS } from '../core/types.js';
import type { PlayParams } from '../core/types.js';
import { ACYCLIC_BOARD, THREE_CYCLE_BOARD, TWO_CYCLE_BOARD } from '../../test/fixtures/board.js';
import { animationComplete, createGameState, isFree, isRemoved, restart, tap } from './state.js';
import type { GameState } from './state.js';

const PLAY_PARAMS: PlayParams = { ...DEFAULT_PLAY_PARAMS, lives: 3, animationDurationMs: 1 };

function freshGame(): GameState {
  return createGameState(ACYCLIC_BOARD, PLAY_PARAMS);
}

/** Advances one queued tap to its resolved effect, as the renderer would after an animation. */
function settle(state: GameState): GameState {
  return animationComplete(state);
}

describe('isFree', () => {
  it('is true only for the segment with no unremoved blockers', () => {
    const state = freshGame();
    expect(isFree(state, 3)).toBe(true);
    expect(isFree(state, 1)).toBe(false);
    expect(isFree(state, 2)).toBe(false);
  });

  it('updates once a blocker is removed', () => {
    let state = freshGame();
    state = settle(tap(state, 3));
    expect(isRemoved(state, 3)).toBe(true);
    expect(isFree(state, 1)).toBe(true);
    expect(isFree(state, 2)).toBe(false);
  });

  it('never reports an already-removed segment as free', () => {
    let state = freshGame();
    state = settle(tap(state, 3));
    expect(isFree(state, 3)).toBe(false);
  });
});

describe('tap: free removal', () => {
  it('removes a free segment and does not cost a life', () => {
    const state = tap(freshGame(), 3);
    expect(state.lastOutcome).toEqual({ kind: 'removed', id: 3 });
    expect(isRemoved(state, 3)).toBe(true);
    expect(state.lives).toBe(PLAY_PARAMS.lives);
    expect(state.animating).toBe(true);
  });
});

describe('tap: blocked bounce', () => {
  it('bounces off a blocked segment and costs exactly one life', () => {
    const state = tap(freshGame(), 1);
    expect(state.lastOutcome).toEqual({
      kind: 'bounced',
      id: 1,
      livesRemaining: PLAY_PARAMS.lives - 1,
    });
    expect(isRemoved(state, 1)).toBe(false);
    expect(state.lives).toBe(PLAY_PARAMS.lives - 1);
    expect(state.status).toBe('playing');
  });
});

describe('tap: miss', () => {
  it('costs no life and removes nothing', () => {
    const state = tap(freshGame(), null);
    expect(state.lastOutcome).toEqual({ kind: 'miss' });
    expect(state.lives).toBe(PLAY_PARAMS.lives);
    expect(state.removedCount).toBe(0);
  });

  it('does not block the queue behind it', () => {
    // The tap that starts an animation resolves synchronously; queue the
    // rest during that animation and confirm the miss does not stall them.
    let state = tap(freshGame(), 1); // bounce, starts "animating"
    state = tap(state, null); // queued miss
    state = tap(state, 3); // queued free removal
    state = settle(state); // resolves the miss, then keeps draining to the removal
    expect(state.lastOutcome).toEqual({ kind: 'removed', id: 3 });
    expect(isRemoved(state, 3)).toBe(true);
  });
});

describe('tap queue during animation', () => {
  it('resolves queued taps strictly in the order they were made', () => {
    let state = tap(freshGame(), 1); // blocked: bounce, now animating
    expect(state.animating).toBe(true);

    state = tap(state, 3); // queued: free removal
    state = tap(state, 1); // queued: now-free removal, once 3 clears it
    expect(state.queue).toEqual([3, 1]);
    expect(isRemoved(state, 3)).toBe(false);

    state = settle(state); // resolves the queued tap on 3
    expect(state.lastOutcome).toEqual({ kind: 'removed', id: 3 });
    expect(isRemoved(state, 3)).toBe(true);
    expect(isRemoved(state, 1)).toBe(false);

    state = settle(state); // resolves the queued tap on 1, now free
    expect(state.lastOutcome).toEqual({ kind: 'removed', id: 1 });
    expect(isRemoved(state, 1)).toBe(true);

    expect(state.queue).toEqual([]);
  });

  it('leaves state untouched when a tap arrives with nothing queued and no animation running', () => {
    const state = freshGame();
    expect(animationComplete(state)).toBe(state);
  });
});

describe('win', () => {
  it('clearing every segment wins', () => {
    let state = freshGame();
    state = settle(tap(state, 3));
    state = settle(tap(state, 1));
    state = settle(tap(state, 2));
    expect(state.status).toBe('won');
    expect(state.removedCount).toBe(ACYCLIC_BOARD.segmentCount);
  });

  it('ignores further taps once the game is won', () => {
    let state = freshGame();
    state = settle(tap(state, 3));
    state = settle(tap(state, 1));
    state = settle(tap(state, 2));
    const won = state;
    expect(tap(won, 1)).toBe(won);
  });
});

describe('restart on zero lives', () => {
  it('preserves the same board object, drops the removed-set, and restores lives', () => {
    let state = createGameState(TWO_CYCLE_BOARD, { ...PLAY_PARAMS, lives: 2 });
    state = settle(tap(state, 1)); // 1 and 2 block each other: always bounces
    expect(state.status).toBe('playing');
    state = settle(tap(state, 2));
    expect(state.status).toBe('lost');
    expect(state.lives).toBe(0);

    const restarted = restart(state);
    expect(restarted.board).toBe(TWO_CYCLE_BOARD);
    expect(restarted.lives).toBe(2);
    expect(restarted.removedCount).toBe(0);
    expect(restarted.status).toBe('playing');
    expect(Array.from(restarted.removed)).toEqual(
      new Array(TWO_CYCLE_BOARD.segmentCount + 1).fill(0),
    );
  });

  it('is a no-op while still playing', () => {
    const state = freshGame();
    expect(restart(state)).toBe(state);
  });

  it('ignores taps once lost, until restart is called', () => {
    let state = createGameState(TWO_CYCLE_BOARD, { ...PLAY_PARAMS, lives: 1 });
    state = settle(tap(state, 1));
    expect(state.status).toBe('lost');
    const lost = state;
    expect(tap(lost, 3)).toBe(lost);
  });
});

describe('a cyclic board', () => {
  it('never crashes or hangs: every segment always bounces', () => {
    let state = createGameState(THREE_CYCLE_BOARD, { ...PLAY_PARAMS, lives: 5 });
    for (let round = 0; round < 20; round++) {
      const before = state.status;
      if (before !== 'playing') {
        state = restart(state);
      }
      state = settle(tap(state, (round % 3) + 1));
    }
    expect(state.board).toBe(THREE_CYCLE_BOARD);
  });
});

describe('property: playing an acyclic board to completion', () => {
  it('any order of always-tapping-a-currently-free-segment eventually wins, board untouched', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 10 }), { minLength: 1, maxLength: 20 }), (picks) => {
        let state = createGameState(ACYCLIC_BOARD, PLAY_PARAMS);
        let pickIndex = 0;
        let guard = 0;
        while (state.status === 'playing' && guard < 100) {
          guard++;
          const free: number[] = [];
          for (let id = 1; id <= state.board.segmentCount; id++) {
            if (isFree(state, id)) free.push(id);
          }
          if (free.length === 0) break;
          const pick = free[(picks[pickIndex % picks.length] as number) % free.length] as number;
          pickIndex++;
          state = settle(tap(state, pick));
        }
        expect(state.status).toBe('won');
        expect(state.board).toBe(ACYCLIC_BOARD);
      }),
    );
  });
});

describe('board identity across a full play-through and restart', () => {
  it('never mutates Board', () => {
    const occupancyBefore = ACYCLIC_BOARD.occupancy.slice();
    const edgeTargetBefore = ACYCLIC_BOARD.edgeTarget.slice();

    let state = createGameState(ACYCLIC_BOARD, { ...PLAY_PARAMS, lives: 1 });
    state = settle(tap(state, 1)); // bounce, lives to 0, lost
    expect(state.status).toBe('lost');
    state = restart(state);
    state = settle(tap(state, 3));
    state = settle(tap(state, 1));
    state = settle(tap(state, 2));
    expect(state.status).toBe('won');

    expect(state.board).toBe(ACYCLIC_BOARD);
    expect(ACYCLIC_BOARD.occupancy).toEqual(occupancyBefore);
    expect(ACYCLIC_BOARD.edgeTarget).toEqual(edgeTargetBefore);
  });
});
