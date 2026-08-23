/** Turns a single-cell request or a `SweepSpec` into the cartesian product of `ParamCell`s the runner sweeps. */

import { DEFAULT_GEN_PARAMS } from '../core/types.js';
import type { Seed } from '../core/types.js';
import type { CellParams, ParamCell, SweepSpec } from './types.js';

const DEFAULT_SEEDS = 20;
const DEFAULT_SEED_BASE = 1;

function seedsFrom(count: number, base: Seed): Seed[] {
  return Array.from({ length: count }, (_, i) => (base + i) >>> 0);
}

/** `DEFAULT_GEN_PARAMS` minus the seed a sweep assigns per board. */
export function defaultCellParams(): CellParams {
  const {
    gridSize,
    meanPieceLength,
    pieceLengthVariance,
    minPieceLength,
    bendProbability,
    minStraightRun,
    fillFraction,
  } = DEFAULT_GEN_PARAMS;
  return {
    gridSize,
    meanPieceLength,
    pieceLengthVariance,
    minPieceLength,
    bendProbability,
    minStraightRun,
    fillFraction,
  };
}

export interface SingleCellOptions {
  readonly seeds?: number;
  readonly seedBase?: number;
  readonly overrides: Partial<CellParams>;
}

export function cellsFromSingle(options: SingleCellOptions): ParamCell[] {
  const params: CellParams = { ...defaultCellParams(), ...options.overrides };
  const seeds = seedsFrom(options.seeds ?? DEFAULT_SEEDS, options.seedBase ?? DEFAULT_SEED_BASE);
  return [{ cellIndex: 0, params, seeds }];
}

export class SweepSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SweepSpecError';
  }
}

export function cellsFromSweepSpec(spec: SweepSpec): ParamCell[] {
  const defaults = defaultCellParams();
  const fieldNames = Object.keys(defaults) as (keyof CellParams)[];
  validateSweepSpec(spec, fieldNames);
  const axes: { readonly key: keyof CellParams; readonly values: readonly number[] }[] =
    fieldNames.map((key) => {
      const raw = spec.params?.[key];
      const values = raw === undefined ? [defaults[key]] : Array.isArray(raw) ? raw : [raw];
      return { key, values };
    });

  const seeds = seedsFrom(spec.seeds ?? DEFAULT_SEEDS, spec.seedBase ?? DEFAULT_SEED_BASE);
  const combos = cartesianProduct(axes);
  return combos.map((params, cellIndex) => ({ cellIndex, params, seeds }));
}

/**
 * A sweep spec arrives as parsed JSON, so a mistyped key is a value nobody
 * reads rather than a type error. Left unchecked the sweep runs one default
 * cell and reports success, which reads as "these parameters make no
 * difference".
 */
function validateSweepSpec(spec: SweepSpec, fieldNames: readonly (keyof CellParams)[]): void {
  if (spec === null || typeof spec !== 'object') {
    throw new SweepSpecError('sweep spec must be a JSON object');
  }
  const known = new Set<string>([...fieldNames, 'seeds', 'seedBase', 'params']);
  for (const key of Object.keys(spec)) {
    if (key === 'seeds' || key === 'seedBase' || key === 'params') continue;
    throw new SweepSpecError(
      `sweep spec has unknown key "${key}"; expected seeds, seedBase or params` +
        (fieldNames.includes(key as keyof CellParams) ? ` — did you mean params.${key}?` : ''),
    );
  }
  // seeds and seedBase reach seedsFrom as-is. A JSON string sails through
  // `base + i` as concatenation, and a count of 0 builds a cell that runs no
  // boards at all, which reports as a clean sweep of nothing.
  assertSeedField(spec.seeds, 'seeds', 1);
  assertSeedField(spec.seedBase, 'seedBase', 0);

  const params = spec.params;
  if (params !== undefined) {
    if (params === null || typeof params !== 'object') {
      throw new SweepSpecError('sweep spec "params" must be a JSON object');
    }
    for (const [key, raw] of Object.entries(params)) {
      if (!known.has(key) || key === 'seeds' || key === 'seedBase' || key === 'params') {
        throw new SweepSpecError(
          `sweep spec params has unknown field "${key}"; expected one of ${fieldNames.join(', ')}`,
        );
      }
      const values = Array.isArray(raw) ? raw : [raw];
      if (values.length === 0) {
        throw new SweepSpecError(
          `sweep spec params.${key} is an empty list, which would sweep nothing at all`,
        );
      }
      for (const value of values) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new SweepSpecError(
            `sweep spec params.${key} contains ${JSON.stringify(value)}, expected a number`,
          );
        }
      }
    }
  }
}

function assertSeedField(value: unknown, name: string, minimum: number): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new SweepSpecError(
      `sweep spec "${name}" is ${JSON.stringify(value)}, expected an integer >= ${minimum}`,
    );
  }
}

function cartesianProduct(
  axes: readonly { readonly key: keyof CellParams; readonly values: readonly number[] }[],
): CellParams[] {
  let combos: Partial<CellParams>[] = [{}];
  for (const axis of axes) {
    const next: Partial<CellParams>[] = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ ...combo, [axis.key]: value });
      }
    }
    combos = next;
  }
  return combos as CellParams[];
}
