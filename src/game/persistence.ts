/**
 * Persists `(seed, params, removedSegments, lives)` to `localStorage` so a
 * reload or a force-quit resumes mid-game. No `Board` is stored, only what
 * regenerates one.
 *
 * `localStorage` throws in more places than its type admits: Safari private
 * mode, over quota, site data disabled. Every read and every write here is
 * wrapped, and a storage failure degrades to "no saved game" or a silently
 * dropped write, never a thrown error.
 *
 * iOS Safari evicts `localStorage`/IndexedDB for a site that has not been
 * added to the home screen after roughly a week of non-use, silently. This
 * module cannot surface that to a player by itself — it has no UI — so a
 * dropped save on iOS is expected for the PoC and is a UI concern to raise,
 * not a defect here.
 */

import type { GenParams, PlayParams } from '../core/types.js';
import type { GameSnapshot } from './state.js';

const STORAGE_KEY = 'arrow-maze:save:v1';
/**
 * Bumped whenever `GenParams` or `PlayParams` gains or loses a field, so a
 * record the previous shape wrote is discarded rather than read back with a
 * field missing.
 */
export const RECORD_VERSION = 2;

/** The slice of `Storage` this module needs, so a test double needs no DOM. */
export interface GameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * A saved game that has passed shape validation. `segmentCount` is the board
 * the record was written against; the controller refuses to restore onto a
 * board that disagrees, which is how a record written by an older generator
 * is caught.
 */
export interface SavedGame {
  readonly genParams: GenParams;
  readonly playParams: PlayParams;
  readonly snapshot: GameSnapshot;
  readonly segmentCount: number;
}

interface StoredRecord {
  readonly version: number;
  readonly genParams: GenParams;
  readonly playParams: PlayParams;
  readonly removedSegments: readonly number[];
  readonly lives: number;
  readonly segmentCount: number;
}

function defaultStorage(): GameStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Every numeric field, with the range it has to land in. A record that
 * merely holds numbers is not enough: `gridSize: -1` and `gridSize: 1e9`
 * both survive a finiteness check, and both reach `generateBoard` on the
 * next launch — one throwing, one hanging, on a board the player cannot
 * clear because they cannot get past it to reach any control.
 */
const GEN_PARAM_RANGES = {
  gridSize: [4, 200],
  seed: [0, 0xffffffff],
  meanPieceLength: [1, 1000],
  pieceLengthVariance: [0, 1000],
  minPieceLength: [1, 1000],
  bendProbability: [0, 1],
  minStraightRun: [1, 1000],
  fillFraction: [0, 1],
  lobeCount: [1, 16],
} as const satisfies Record<keyof GenParams, readonly [number, number]>;

const PLAY_PARAM_RANGES = {
  lives: [0, 1000],
  animationDurationMs: [0, 60_000],
} as const satisfies Record<keyof PlayParams, readonly [number, number]>;

function hasNumberFieldsInRange(
  value: unknown,
  ranges: Record<string, readonly [number, number]>,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(ranges).every(([key, [min, max]]) => {
    const field = record[key];
    return isFiniteNumber(field) && field >= min && field <= max;
  });
}

function isGenParams(value: unknown): value is GenParams {
  return hasNumberFieldsInRange(value, GEN_PARAM_RANGES);
}

function isPlayParams(value: unknown): value is PlayParams {
  return hasNumberFieldsInRange(value, PLAY_PARAM_RANGES);
}

/**
 * Shape-validates a record read back from storage: untrusted input that may
 * be truncated JSON, a number where an array should be, or a record a
 * previous, differently-shaped build wrote. A version or a parameter outside
 * its range is discarded rather than repaired: a record patched into validity
 * names a different board than the one the player was on. Unrecognised extra
 * keys are ignored.
 */
function isStoredRecord(value: unknown): value is StoredRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== RECORD_VERSION) return false;
  if (!isGenParams(record.genParams)) return false;
  if (!isPlayParams(record.playParams)) return false;
  if (!isFiniteNumber(record.lives) || !Number.isInteger(record.lives) || record.lives < 0) {
    return false;
  }
  const segmentCount = record.segmentCount;
  if (!isFiniteNumber(segmentCount) || !Number.isInteger(segmentCount) || segmentCount < 0) {
    return false;
  }
  if (!Array.isArray(record.removedSegments)) return false;
  // `segmentCount` is checked first so this bounds the walk below: a record
  // claiming more removed segments than the board holds is rejected on its
  // length, before anything iterates a tampered array.
  if (record.removedSegments.length > segmentCount) return false;
  return record.removedSegments.every(
    (id) => Number.isInteger(id) && id >= 1 && id <= segmentCount,
  );
}

/**
 * Reads the saved game, if any. Returns `null` for no save, a storage
 * failure, malformed JSON, or a shape mismatch — the same "start fresh"
 * signal in every case, since the caller has nothing different to do about
 * any of them.
 *
 * No board is generated here. The caller generates one anyway to play on,
 * and generation is the expensive step of a resume; regenerating a second
 * one only to read `segmentCount` off it would double the wait at the sizes
 * where it is already longest.
 */
export function loadSavedGame(
  storage: GameStorage | undefined = defaultStorage(),
): SavedGame | null {
  if (storage === undefined) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStoredRecord(parsed)) return null;

  return {
    genParams: parsed.genParams,
    playParams: parsed.playParams,
    snapshot: { removedSegments: parsed.removedSegments, lives: parsed.lives },
    segmentCount: parsed.segmentCount,
  };
}

/**
 * Writes the current game to storage, replacing any previous save. `Board`
 * is immutable and `segmentCount` never changes across a session, so the
 * caller — which already generated the board once — passes it rather than
 * this module regenerating a board on every call just to read one field off
 * it.
 */
export function saveGame(
  snapshot: GameSnapshot,
  genParams: GenParams,
  playParams: PlayParams,
  segmentCount: number,
  storage: GameStorage | undefined = defaultStorage(),
): void {
  if (storage === undefined) return;
  const record: StoredRecord = {
    version: RECORD_VERSION,
    genParams,
    playParams,
    removedSegments: [...snapshot.removedSegments],
    lives: snapshot.lives,
    segmentCount,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Quota, private mode, or disabled site data. A dropped save falls back
    // to a fresh board on next load, never a crash.
  }
}

/** Drops the saved game, if any. Used after a win or whenever resuming is no longer meaningful. */
export function clearSavedGame(storage: GameStorage | undefined = defaultStorage()): void {
  if (storage === undefined) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Same failure modes as saveGame; nothing to recover, nothing to crash.
  }
}
