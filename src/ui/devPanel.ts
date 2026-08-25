/**
 * Pure logic behind the dev panel: field bounds, clamping, parsing and
 * formatting. Kept out of the component so it is testable without a DOM.
 */

import type { GenParams, PlayParams } from '../core/types.js';

export type GenFieldKey =
  | 'gridSize'
  | 'seed'
  | 'meanPieceLength'
  | 'pieceLengthVariance'
  | 'bendProbability'
  | 'minStraightRun';

export type PlayFieldKey = 'lives' | 'animationDurationMs';

export interface FieldSpec<K extends string> {
  readonly key: K;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Values round to the nearest integer rather than staying fractional. */
  readonly integer: boolean;
}

/** Bounds are UI choices, not contract: `GenParams` itself accepts any finite number. */
export const GEN_FIELDS: readonly FieldSpec<GenFieldKey>[] = [
  { key: 'gridSize', label: 'Grid size', min: 20, max: 100, step: 1, integer: true },
  { key: 'seed', label: 'Seed', min: 0, max: 0xffffffff, step: 1, integer: true },
  { key: 'meanPieceLength', label: 'Mean piece length', min: 1, max: 40, step: 1, integer: false },
  {
    key: 'pieceLengthVariance',
    label: 'Piece length variance',
    min: 0,
    max: 20,
    step: 0.5,
    integer: false,
  },
  {
    key: 'bendProbability',
    label: 'Bend probability',
    min: 0,
    max: 1,
    step: 0.01,
    integer: false,
  },
  { key: 'minStraightRun', label: 'Min straight run', min: 1, max: 10, step: 1, integer: true },
];

export const PLAY_FIELDS: readonly FieldSpec<PlayFieldKey>[] = [
  { key: 'lives', label: 'Lives', min: 1, max: 10, step: 1, integer: true },
  {
    key: 'animationDurationMs',
    label: 'Animation duration',
    min: 100,
    max: 2000,
    step: 10,
    integer: true,
  },
];

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampToField<K extends string>(value: number, field: FieldSpec<K>): number {
  const clamped = clampNumber(value, field.min, field.max);
  return field.integer ? Math.round(clamped) : clamped;
}

/** Empty or unparsable input falls back rather than snapping to a bound the player didn't type. */
export function parseFieldInput<K extends string>(
  raw: string,
  field: FieldSpec<K>,
  fallback: number,
): number {
  if (raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? clampToField(value, field) : fallback;
}

export function withGenField(params: GenParams, key: GenFieldKey, value: number): GenParams {
  return { ...params, [key]: value };
}

export function withPlayField(params: PlayParams, key: PlayFieldKey, value: number): PlayParams {
  return { ...params, [key]: value };
}

export function formatFixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function formatPercent(value: number, digits = 0): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

export function formatMs(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : '—';
}

export function formatInt(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value)}` : '—';
}

/** `random` is injectable so the distribution is testable without stubbing `Math.random`. */
export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x100000000);
}

/** How long a drag rests before a regenerate fires, so a dragged slider does not regenerate per tick. */
export const REGENERATE_DEBOUNCE_MS = 300;
