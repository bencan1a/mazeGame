import { describe, expect, it } from 'vitest';
import { generateBoard } from '../core/generate.js';
import { DEFAULT_GEN_PARAMS, DEFAULT_PLAY_PARAMS } from '../core/types.js';
import { saveGame, type GameStorage } from '../game/persistence.js';
import { createFixtureLibrary } from '../game/shapes.js';
import {
  drawingFor,
  initialScreen,
  readBrowsedIndex,
  readValidSave,
  shapeIdFromLocation,
  writeBrowsedIndex,
} from './App.js';

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

const library = createFixtureLibrary();
const SEGMENT_COUNT = generateBoard(DEFAULT_GEN_PARAMS).segmentCount;

function saveForShape(storage: GameStorage, shapeId: string | null): void {
  saveGame(
    { removedSegments: [], lives: DEFAULT_PLAY_PARAMS.lives },
    DEFAULT_GEN_PARAMS,
    DEFAULT_PLAY_PARAMS,
    SEGMENT_COUNT,
    shapeId,
    storage,
  );
}

describe('readBrowsedIndex / writeBrowsedIndex', () => {
  it('round-trips an index that fits the library', () => {
    const storage = new FakeStorage();
    writeBrowsedIndex(2, storage);
    expect(readBrowsedIndex(3, storage)).toBe(2);
  });

  it('falls back to 0 with no storage available', () => {
    expect(readBrowsedIndex(3, undefined)).toBe(0);
  });

  it('falls back to 0 for an index the library has since shrunk past', () => {
    const storage = new FakeStorage();
    writeBrowsedIndex(5, storage);
    expect(readBrowsedIndex(3, storage)).toBe(0);
  });

  it('falls back to 0 for a corrupted entry', () => {
    const storage = new FakeStorage();
    storage.setItem('arrow-maze:home-index:v1', 'not a number');
    expect(readBrowsedIndex(3, storage)).toBe(0);
  });

  it('falls back to 0 for an empty library, never dividing by it', () => {
    expect(readBrowsedIndex(0, new FakeStorage())).toBe(0);
  });
});

describe('shapeIdFromLocation', () => {
  it('reads the shape id out of ?shape=', () => {
    expect(shapeIdFromLocation('?shape=ring')).toBe('ring');
  });

  it('returns null with no shape parameter present', () => {
    expect(shapeIdFromLocation('?grid=40')).toBeNull();
    expect(shapeIdFromLocation('')).toBeNull();
  });

  it('returns null with no location available', () => {
    expect(shapeIdFromLocation(undefined)).toBeNull();
  });
});

describe('readValidSave', () => {
  it('keeps a save naming a shape the library has', () => {
    const storage = new FakeStorage();
    saveForShape(storage, 'house');
    expect(readValidSave(library, storage)?.shapeId).toBe('house');
  });

  it('discards a save naming a shape the library does not have, rather than half-restoring it', () => {
    const storage = new FakeStorage();
    saveForShape(storage, 'not-in-the-library');
    expect(readValidSave(library, storage)).toBeNull();
    // The discard is not just reported once: it is written back, so a second
    // read finds nothing left to discard either.
    expect(storage.getItem('arrow-maze:save:v1')).toBeNull();
  });

  it('keeps a procedural save with no shape at all', () => {
    const storage = new FakeStorage();
    saveForShape(storage, null);
    expect(readValidSave(library, storage)?.shapeId).toBeNull();
  });

  it('returns null with no save present', () => {
    expect(readValidSave(library, new FakeStorage())).toBeNull();
  });
});

describe('initialScreen', () => {
  it('opens the game on a shape named by ?shape=', () => {
    const screen = initialScreen(library, '?shape=house', undefined);
    expect(screen).toEqual({ kind: 'game', shapeId: 'house' });
  });

  it('sends an unknown ?shape= to home rather than erroring', () => {
    const screen = initialScreen(library, '?shape=not-in-the-library', undefined);
    expect(screen).toEqual({ kind: 'home' });
  });

  it('resumes the shape holding the one save when there is no ?shape=', () => {
    const storage = new FakeStorage();
    saveForShape(storage, 'ring');
    expect(initialScreen(library, '', storage)).toEqual({ kind: 'game', shapeId: 'ring' });
  });

  it('opens on home with no ?shape= and no save', () => {
    expect(initialScreen(library, '', new FakeStorage())).toEqual({ kind: 'home' });
  });

  it('resumes a save that names no shape rather than stranding it', () => {
    // Every save written before the library existed is one of these, and a
    // save the home screen cannot reach is one the next Play silently
    // overwrites.
    const storage = new FakeStorage();
    saveForShape(storage, null);
    expect(initialScreen(library, '', storage)).toEqual({ kind: 'game', shapeId: null });
  });

  it('opens on home for a save naming a shape the library no longer has', () => {
    const storage = new FakeStorage();
    saveForShape(storage, 'not-in-the-library');
    expect(initialScreen(library, '', storage)).toEqual({ kind: 'home' });
  });

  it('prefers a known ?shape= over an existing save for a different shape', () => {
    const storage = new FakeStorage();
    saveForShape(storage, 'ring');
    expect(initialScreen(library, '?shape=house', storage)).toEqual({
      kind: 'game',
      shapeId: 'house',
    });
  });
});

describe('drawingFor', () => {
  it('hands the board the drawing the library holds, at its bake size', () => {
    const drawing = drawingFor(library, 'ring');
    expect(drawing?.edge).toBe(library.edge);
    expect(drawing?.ink).toEqual(library.ink('ring'));
  });

  it('has no drawing for a board that names no shape', () => {
    expect(drawingFor(library, null)).toBeNull();
  });

  it('has no drawing for a shape the library cannot draw', () => {
    expect(drawingFor(library, 'not-in-the-library')).toBeNull();
  });
});
