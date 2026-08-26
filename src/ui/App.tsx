import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  clearSavedGame,
  loadSavedGame,
  type GameStorage,
  type SavedGame,
} from '../game/persistence.js';
import { loadShapeLibrary } from '../game/shapeLibrary.js';
import type { ShapeDrawing } from '../game/shapeBoard.js';
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

/** A URL naming a board is a request for that board, shape or no shape. */
export function namesABoard(search: string | undefined = defaultSearch()): boolean {
  if (search === undefined) return false;
  const query = new URLSearchParams(search);
  return (query.get('seed') ?? '') !== '' || (query.get('grid') ?? '') !== '';
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
  { readonly kind: 'home' } | { readonly kind: 'game'; readonly shapeId: string | null };

export function initialScreen(
  library: ShapeLibrary,
  search: string | undefined = defaultSearch(),
  storage: GameStorage | undefined = defaultStorage(),
): Screen {
  const requested = shapeIdFromLocation(search);
  if (requested !== null && library.shapes.some((shape) => shape.id === requested)) {
    return { kind: 'game', shapeId: requested };
  }
  if (namesABoard(search)) return { kind: 'game', shapeId: null };
  const saved = readValidSave(library, storage);
  if (saved !== null) return { kind: 'game', shapeId: saved.shapeId };
  return { kind: 'home' };
}

/** What the player is told when the baked library could not be read. */
export const FALLBACK_NOTICE = 'The shape library did not load, so only a few shapes are here.';

/**
 * The baked asset, or the fixture library if it cannot be read. A missing or
 * truncated asset is a bad build or a half-written cache, neither of which the
 * player can do anything about, so they land on a smaller library that still
 * plays rather than on an empty screen.
 */
function useShapeLibrary(): { library: ShapeLibrary | null; notice: string | null } {
  const [loaded, setLoaded] = useState<{ library: ShapeLibrary; notice: string | null } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    void loadShapeLibrary().then(
      (library) => {
        if (live) setLoaded({ library, notice: null });
      },
      (cause: unknown) => {
        console.warn('shape library unavailable', cause);
        if (live) setLoaded({ library: createFixtureLibrary(), notice: FALLBACK_NOTICE });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return { library: loaded?.library ?? null, notice: loaded?.notice ?? null };
}

export function App(): ReactElement {
  const { library, notice } = useShapeLibrary();
  if (library === null) {
    return (
      <div className="home-screen">
        <p className="home-title">Loading shapes…</p>
      </div>
    );
  }
  return <Library library={library} notice={notice} />;
}

/** A shape with no bitmap behind it plays a procedural board rather than none. */
export function drawingFor(library: ShapeLibrary, shapeId: string | null): ShapeDrawing | null {
  if (shapeId === null) return null;
  const ink = library.ink(shapeId);
  return ink === null ? null : { ink, edge: library.edge };
}

interface LibraryProps {
  readonly library: ShapeLibrary;
  readonly notice: string | null;
}

/**
 * Two screens, never both mounted: home browses the library, game owns one
 * board. Leaving the board keeps its save; entering a different shape
 * overwrites the one save slot as soon as that board has anything to persist.
 */
function Library({ library, notice }: LibraryProps): ReactElement {
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
    const drawing = drawingFor(library, screen.shapeId);
    return (
      <BoardMount
        shapeId={screen.shapeId}
        onExit={goHome}
        {...(drawing === null ? {} : { drawing })}
      />
    );
  }

  return (
    <HomeScreen
      library={library}
      index={browsedIndex}
      onPrevious={() => step(-1)}
      onNext={() => step(1)}
      onPlay={play}
      resumeShapeId={resumeShapeId}
      notice={notice}
    />
  );
}
