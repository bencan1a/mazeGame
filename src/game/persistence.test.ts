import { describe, expect, it } from 'vitest';
import { generateBoard } from '../core/generate.js';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';
import type { GenParams, PlayParams } from '../core/types.js';
import {
  RECORD_VERSION,
  clearSavedGame,
  loadSavedGame,
  saveGame,
  type GameStorage,
} from './persistence.js';

const GEN_PARAMS: GenParams = { ...DEFAULT_GEN_PARAMS, gridSize: 20, seed: 5 };
const PLAY_PARAMS: PlayParams = { ...DEFAULT_PLAY_PARAMS, lives: 3 };
const SEGMENT_COUNT = generateBoard(GEN_PARAMS).segmentCount;

/** An in-memory `GameStorage` so no test needs a DOM. */
class FakeStorage implements GameStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

/** A storage whose named method always throws, like Safari private mode. */
class ThrowingStorage implements GameStorage {
  constructor(private readonly method: 'getItem' | 'setItem' | 'removeItem') {}

  getItem(): string | null {
    if (this.method === 'getItem') throw new Error('denied');
    return null;
  }

  setItem(): void {
    if (this.method === 'setItem') throw new Error('denied');
  }

  removeItem(): void {
    if (this.method === 'removeItem') throw new Error('denied');
  }
}

describe('saveGame / loadSavedGame round trip', () => {
  it('restores the same seed, params, removed segments and lives that were saved', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [1, 3, 5], lives: 2 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      'house',
      storage,
    );

    const loaded = loadSavedGame(storage);

    expect(loaded).not.toBeNull();
    expect(loaded?.genParams).toEqual(GEN_PARAMS);
    expect(loaded?.playParams).toEqual(PLAY_PARAMS);
    expect(loaded?.snapshot).toEqual({
      removedSegments: [1, 3, 5],
      bouncedSegments: [],
      lives: 2,
    });
    expect(loaded?.segmentCount).toBe(SEGMENT_COUNT);
    expect(loaded?.shapeId).toBe('house');
  });

  it('carries out the segment count the save was written against', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [], lives: 3 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      null,
      storage,
    );

    expect(loadSavedGame(storage)?.segmentCount).toBe(generateBoard(GEN_PARAMS).segmentCount);
  });

  it('defaults an unspecified shape to null, for a procedural board', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [], lives: 3 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      undefined,
      storage,
    );

    expect(loadSavedGame(storage)?.shapeId).toBeNull();
  });

  it('reads a record written before shapes existed as having none', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION,
        genParams: GEN_PARAMS,
        playParams: PLAY_PARAMS,
        removedSegments: [],
        lives: 3,
        segmentCount: SEGMENT_COUNT,
      }),
    );

    expect(loadSavedGame(storage)?.shapeId).toBeNull();
  });

  it('discards a record whose shape id is not a string or null', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION,
        genParams: GEN_PARAMS,
        playParams: PLAY_PARAMS,
        removedSegments: [],
        lives: 3,
        segmentCount: SEGMENT_COUNT,
        shapeId: 42,
      }),
    );

    expect(loadSavedGame(storage)).toBeNull();
  });
});

describe('loadSavedGame validation', () => {
  it('discards a record with no save present', () => {
    expect(loadSavedGame(new FakeStorage())).toBeNull();
  });

  it('discards a record whose version does not match', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION + 1,
        genParams: GEN_PARAMS,
        playParams: PLAY_PARAMS,
        removedSegments: [],
        lives: 3,
        segmentCount: SEGMENT_COUNT,
      }),
    );

    expect(loadSavedGame(storage)).toBeNull();
  });

  it('discards a record naming a segment beyond the board it was written against', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION,
        genParams: GEN_PARAMS,
        playParams: PLAY_PARAMS,
        removedSegments: [SEGMENT_COUNT + 1],
        lives: 3,
        segmentCount: SEGMENT_COUNT,
      }),
    );

    expect(loadSavedGame(storage)).toBeNull();
  });

  it('discards malformed JSON rather than throwing', () => {
    const storage = new FakeStorage();
    storage.setItem('arrow-maze:save:v1', '{not json');

    expect(() => loadSavedGame(storage)).not.toThrow();
    expect(loadSavedGame(storage)).toBeNull();
  });

  it('discards a record missing required fields', () => {
    const storage = new FakeStorage();
    storage.setItem('arrow-maze:save:v1', JSON.stringify({ version: RECORD_VERSION }));

    expect(loadSavedGame(storage)).toBeNull();
  });

  it('discards a record whose params carry the wrong shape entirely', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({ version: RECORD_VERSION, genParams: 'oops' }),
    );

    expect(loadSavedGame(storage)).toBeNull();
  });

  it('discards removedSegments outside the regenerated board', () => {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION,
        genParams: GEN_PARAMS,
        playParams: PLAY_PARAMS,
        removedSegments: [SEGMENT_COUNT + 100],
        lives: 3,
        segmentCount: SEGMENT_COUNT,
      }),
    );

    expect(loadSavedGame(storage)).toBeNull();
  });

  it('returns null rather than throwing when getItem throws', () => {
    const storage = new ThrowingStorage('getItem');

    expect(() => loadSavedGame(storage)).not.toThrow();
    expect(loadSavedGame(storage)).toBeNull();
  });

  it('treats absent storage as no saved game, with no DOM required', () => {
    expect(loadSavedGame(undefined)).toBeNull();
  });

  it('resolves to no storage at all under a headless (window-less) test environment', () => {
    expect(loadSavedGame()).toBeNull();
  });
});

describe('saveGame failure handling', () => {
  it('does not throw when setItem throws', () => {
    const storage = new ThrowingStorage('setItem');

    expect(() =>
      saveGame(
        { removedSegments: [], lives: 3 },
        GEN_PARAMS,
        PLAY_PARAMS,
        SEGMENT_COUNT,
        null,
        storage,
      ),
    ).not.toThrow();
  });

  it('is a no-op with no storage available', () => {
    expect(() =>
      saveGame(
        { removedSegments: [], lives: 3 },
        GEN_PARAMS,
        PLAY_PARAMS,
        SEGMENT_COUNT,
        null,
        undefined,
      ),
    ).not.toThrow();
  });
});

describe('clearSavedGame', () => {
  it('removes a previously saved game', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [1], lives: 2 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      null,
      storage,
    );

    clearSavedGame(storage);

    expect(loadSavedGame(storage)).toBeNull();
  });

  it('does not throw when removeItem throws', () => {
    expect(() => clearSavedGame(new ThrowingStorage('removeItem'))).not.toThrow();
  });

  it('is a no-op with no storage available', () => {
    expect(() => clearSavedGame(undefined)).not.toThrow();
  });
});

describe('loadSavedGame parameter ranges', () => {
  function storedWith(genParams: Record<string, number>): GameStorage {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION,
        genParams,
        playParams: PLAY_PARAMS,
        removedSegments: [],
        lives: 3,
        segmentCount: SEGMENT_COUNT,
      }),
    );
    return storage;
  }

  it('discards a grid size that would throw or hang on the next launch', () => {
    for (const gridSize of [0, -1, 1e9]) {
      expect(loadSavedGame(storedWith({ ...GEN_PARAMS, gridSize }))).toBeNull();
    }
  });

  it('discards a seed the rng would silently truncate to a different board', () => {
    for (const seed of [-1, 0x100000000]) {
      expect(loadSavedGame(storedWith({ ...GEN_PARAMS, seed }))).toBeNull();
    }
  });

  it('discards a steer outside the range it is defined on', () => {
    for (const bendProbability of [-0.1, 1.1]) {
      expect(loadSavedGame(storedWith({ ...GEN_PARAMS, bendProbability }))).toBeNull();
    }
    for (const fillFraction of [-0.1, 1.1]) {
      expect(loadSavedGame(storedWith({ ...GEN_PARAMS, fillFraction }))).toBeNull();
    }
  });

  it('keeps a record whose parameters all sit in range', () => {
    expect(loadSavedGame(storedWith({ ...GEN_PARAMS }))).not.toBeNull();
  });

  it('ignores an unrecognised extra key rather than discarding the save', () => {
    expect(loadSavedGame(storedWith({ ...GEN_PARAMS, somethingNew: 3 }))).not.toBeNull();
  });
});

describe('loadSavedGame removed-segment bounds', () => {
  function stored(removedSegments: unknown, segmentCount = SEGMENT_COUNT): GameStorage {
    const storage = new FakeStorage();
    storage.setItem(
      'arrow-maze:save:v1',
      JSON.stringify({
        version: RECORD_VERSION,
        genParams: GEN_PARAMS,
        playParams: PLAY_PARAMS,
        removedSegments,
        lives: 3,
        segmentCount,
      }),
    );
    return storage;
  }

  it('discards a list longer than the board it claims', () => {
    const tooMany = Array.from({ length: SEGMENT_COUNT + 1 }, (_, i) => i + 1);
    expect(loadSavedGame(stored(tooMany))).toBeNull();
  });

  it('discards an id past the end of the board it claims', () => {
    expect(loadSavedGame(stored([SEGMENT_COUNT + 1]))).toBeNull();
  });

  it('discards an id below the 1-based floor', () => {
    expect(loadSavedGame(stored([0]))).toBeNull();
    expect(loadSavedGame(stored([-1]))).toBeNull();
  });

  it('keeps a list that fits the board it claims', () => {
    expect(loadSavedGame(stored([1, 2]))).not.toBeNull();
  });
});

describe('bounce marks in a save', () => {
  it('round-trips the bounced set', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [2], bouncedSegments: [1, 4], lives: 1 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      null,
      storage,
    );

    expect(loadSavedGame(storage)?.snapshot.bouncedSegments).toEqual([1, 4]);
  });

  it('reads a record written before bounce marks existed as having none', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [2], lives: 1 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      null,
      storage,
    );
    const stored = JSON.parse(storage.getItem('arrow-maze:save:v1') as string) as Record<
      string,
      unknown
    >;
    delete stored.bouncedSegments;
    storage.setItem('arrow-maze:save:v1', JSON.stringify(stored));

    expect(loadSavedGame(storage)?.snapshot.bouncedSegments).toEqual([]);
  });

  it('discards a record whose bounced set names a segment off the board', () => {
    const storage = new FakeStorage();
    saveGame(
      { removedSegments: [], lives: 1 },
      GEN_PARAMS,
      PLAY_PARAMS,
      SEGMENT_COUNT,
      null,
      storage,
    );
    const stored = JSON.parse(storage.getItem('arrow-maze:save:v1') as string) as Record<
      string,
      unknown
    >;
    stored.bouncedSegments = [SEGMENT_COUNT + 1];
    storage.setItem('arrow-maze:save:v1', JSON.stringify(stored));

    expect(loadSavedGame(storage)).toBeNull();
  });
});
