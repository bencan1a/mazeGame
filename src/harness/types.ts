import type { BoardMetrics, GenParams, Seed } from '../core/types.js';
import type { PeelStats } from '../core/segment/index.js';

/** One point in the swept parameter space, minus the seed it will be run at. */
export type CellParams = Omit<GenParams, 'seed'>;

export interface ParamCell {
  readonly cellIndex: number;
  readonly params: CellParams;
  readonly seeds: readonly Seed[];
}

export interface BoardRowOk {
  readonly cellIndex: number;
  readonly seed: Seed;
  readonly params: GenParams;
  readonly ok: true;
  readonly attempts: number;
  /** `metrics.generationMs` is the wall clock the harness measured around `generateBoardWithDiagnostics`, not a value `computeMetrics` can produce on its own. */
  readonly metrics: BoardMetrics;
  readonly peel: PeelStats;
}

export interface BoardRowFailed {
  readonly cellIndex: number;
  readonly seed: Seed;
  readonly params: GenParams;
  readonly ok: false;
  readonly error: string;
}

export type BoardRow = BoardRowOk | BoardRowFailed;

export interface Stat {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

export interface CellAggregate {
  readonly cellIndex: number;
  readonly params: CellParams;
  readonly seedCount: number;
  readonly failureCount: number;
  readonly failedSeeds: readonly Seed[];
  readonly generationMs: Stat;
  readonly attempts: Stat;
  readonly segmentCount: Stat;
  readonly coverage: Stat;
  readonly meanSegmentLength: Stat;
  readonly bendRate: Stat;
  readonly dagDepth: Stat;
  readonly meanFreeSetSize: Stat;
  readonly minFreeSetSize: Stat;
  readonly edgeCount: Stat;
  readonly shortOfTarget: Stat;
  readonly belowMinimum: Stat;
  readonly wholeRunEscapes: Stat;
  readonly shortStraightRuns: Stat;
}

/** The JSON grid a `--sweep` file describes. Any field omitted takes the corresponding `DEFAULT_GEN_PARAMS` value. */
export interface SweepSpec {
  readonly seeds?: number;
  readonly seedBase?: number;
  readonly params?: {
    readonly [K in keyof CellParams]?: CellParams[K] | readonly CellParams[K][];
  };
}
