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

export function cellsFromSweepSpec(spec: SweepSpec): ParamCell[] {
  const defaults = defaultCellParams();
  const fieldNames = Object.keys(defaults) as (keyof CellParams)[];
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
