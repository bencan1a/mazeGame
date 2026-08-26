import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  clearSavedGame,
  loadSavedGame,
  type GameStorage,
  type SavedGame,
} from '../game/persistence.js';
import { createFixtureLibrary, type ShapeLibrary } from '../game/shapes.js';
import { BoardMount } from './BoardMount.js';
import { HomeScreen } from './HomeScreen.js';

const BROWSED_INDEX_KEY = 'arrow-maze:home-index:v1';

function defaultStorage(): GameStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function defaultSearch(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.search;
}

export function readBrowsedIndex(
  shapeCount: number,
  storage: GameStorage | undefined = defaultStorage(),
): number {
  if (storage === undefined || shapeCount <= 0) return 0;
  try {
    const raw = storage.getItem(BROWSED_INDEX_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isInteger(value) && value >= 0 && value < shapeCount ? value : 0;
  } catch {
    return 0;
  }
}

export function writeBrowsedIndex(
  index: number,
  storage: GameStorage | undefined = defaultStorage(),
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(BROWSED_INDEX_KEY, String(index));
  } catch {
    // Best effort; a lost index just reopens the library at its first shape.
  }
}

export function shapeIdFromLocation(search: string | undefined = defaultSearch()): string | null {
  if (search === undefined) return null;
  return new URLSearchParams(search).get('shape');
}

/**
 * A save naming a shape the library no longer has is discarded rather than
 * half-restored: there is nothing to resume it onto. `null` covers both "no
 * save" and "the save was just discarded" — the caller has nothing different
 * to do about either.
 */
export function readValidSave(
  library: ShapeLibrary,
  storage: GameStorage | undefined = defaultStorage(),
): SavedGame | null {
  const saved = loadSavedGame(storage);
  if (saved === null) return null;
  if (saved.shapeId !== null && !library.shapes.some((shape) => shape.id === saved.shapeId)) {
    clearSavedGame(storage);
    return null;
  }
  return saved;
}

export type Screen =
  { readonly kind: 'home' } | { readonly kind: 'game'; readonly shapeId: string };

export function initialScreen(
  library: ShapeLibrary,
  search: string | undefined = defaultSearch(),
  storage: GameStorage | undefined = defaultStorage(),
): Screen {
  const requested = shapeIdFromLocation(search);
  if (requested !== null && library.shapes.some((shape) => shape.id === requested)) {
    return { kind: 'game', shapeId: requested };
  }
  const saved = readValidSave(library, storage);
  if (saved !== null && saved.shapeId !== null) {
    return { kind: 'game', shapeId: saved.shapeId };
  }
  return { kind: 'home' };
}

/**
 * Two screens, never both mounted: home browses the library, game owns one
 * board. Leaving the board keeps its save; entering a different shape
 * overwrites the one save slot as soon as that board has anything to persist.
 */
export function App(): ReactElement {
  const [library] = useState<ShapeLibrary>(createFixtureLibrary);
  const [screen, setScreen] = useState<Screen>(() => initialScreen(library));
  const [browsedIndex, setBrowsedIndex] = useState<number>(() =>
    readBrowsedIndex(library.shapes.length),
  );
  const [resumeShapeId, setResumeShapeId] = useState<string | null>(
    () => readValidSave(library)?.shapeId ?? null,
  );

  useEffect(() => writeBrowsedIndex(browsedIndex), [browsedIndex]);

  // Runs after `BoardMount`'s own unmount has flushed its pending write, so
  // this always reads the save the player actually left behind rather than
  // one still waiting on a timer.
  useEffect(() => {
    if (screen.kind !== 'home') return;
    setResumeShapeId(readValidSave(library)?.shapeId ?? null);
  }, [screen, library]);

  const shapeCount = library.shapes.length;
  const step = useCallback(
    (delta: number) => {
      if (shapeCount === 0) return;
      setBrowsedIndex((was) => (was + delta + shapeCount) % shapeCount);
    },
    [shapeCount],
  );

  const play = useCallback(() => {
    const shape = library.shapes[browsedIndex];
    if (shape === undefined) return;
    setScreen({ kind: 'game', shapeId: shape.id });
  }, [library, browsedIndex]);

  const goHome = useCallback(() => setScreen({ kind: 'home' }), []);

  if (screen.kind === 'game') {
    return <BoardMount shapeId={screen.shapeId} onExit={goHome} />;
  }

  return (
    <HomeScreen
      library={library}
      index={browsedIndex}
      onPrevious={() => step(-1)}
      onNext={() => step(1)}
      onPlay={play}
      resumeShapeId={resumeShapeId}
    />
  );
}
