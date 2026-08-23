/**
 * Randomized local search for an acyclic head assignment (issue #10, PRD
 * §4.2 step 4): build the blocking digraph, find its SCCs, flip a segment
 * inside a non-trivial one, recheck. Not 2-SAT - acyclicity is a global
 * property of the whole digraph, not a clause over pairs of literals - so
 * this is a search over the (mostly 2^n, larger where a length-1 segment
 * contributes 4 choices instead of 2) space of orientation choices, not a
 * solver.
 *
 * Boxed by **iteration count**, not wall-clock time: `src/core/` is a pure
 * function of `(seed, params)` (ADR-0004), and a millisecond budget would
 * make the same seed converge or not depending on the machine it runs on.
 * `Date.now`/`performance.now` are lint errors in this directory for the same
 * reason. `maxIterations` is the whole budget.
 *
 * Each flip only ever invalidates the flipped segment's own outgoing row
 * (see incrementalRow.ts for why), so the digraph is kept as one row per
 * segment and only the flipped row is recomputed each iteration, flattening
 * to CSR for Tarjan afterwards. A full `buildBlockingGraph` call is only
 * paid once, for the starting orientation.
 */

import type { Rng } from '../rng.js';
import type { Direction } from '../types.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import type { BlockingGraph, BlockingGraphInput } from './blocking.js';
import { computeHeadCandidates } from './headOptions.js';
import type { HeadCandidates } from './headOptions.js';
import { recomputeRow } from './incrementalRow.js';
import { countCyclicComponents, cyclicNodes, tarjanSCC } from './tarjan.js';
import type { CsrGraph } from './tarjan.js';

/**
 * A time budget in disguise, not a convergence target: at ~0.1ms/iteration
 * (measured; incremental row updates dominate the cost, see
 * incrementalRow.ts), 2000 iterations costs on the order of 100-250ms even
 * on a dense 100x100 board, leaving headroom in PRD's 1s generation budget
 * for the rest of the pipeline.
 *
 * It is not high enough to make local search converge reliably at every
 * size - this issue's report has the numbers: at 40x40 it converges on
 * essentially every board tried, comfortably inside this box, but at
 * 100x100 with default `GenParams` it very rarely does. That is not a bug
 * in the search; a random-flip search over 2^n orientations without a
 * smarter move rule needs tens of thousands of flips at ~700 segments, and
 * spending seconds chasing that would blow the generation budget on its
 * own. Reverse construction (#11) exists precisely so this box can stay
 * time-conscious instead of convergence-chasing - see the report for why
 * that makes the fallback the *normal* path at large sizes, not a rare one.
 */
export const DEFAULT_MAX_ITERATIONS = 2000;

export interface LocalSearchStats {
  readonly converged: boolean;
  /** Flips attempted before converging or giving up. */
  readonly iterations: number;
  /** Always equal to `iterations` for this search (one flip per iteration); kept distinct in case a future variant flips more than one segment per step. */
  readonly flips: number;
  readonly initialSccCount: number;
  /** 0 when converged. */
  readonly finalSccCount: number;
}

export interface LocalSearchResult extends LocalSearchStats {
  readonly segHead: Uint32Array;
  readonly segDir: Uint8Array;
  /** 1 = the caller must reverse this segment's `segCells` slice; see headOptions.ts. */
  readonly segReversed: Uint8Array;
}

export interface LocalSearchOptions {
  readonly maxIterations?: number;
}

export function orientByLocalSearch(
  segments: SegmentedPath,
  occupancy: Uint16Array,
  width: number,
  height: number,
  rng: Rng,
  options: LocalSearchOptions = {},
): LocalSearchResult {
  const segmentCount = segments.segStart.length - 1;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const candidates = computeHeadCandidates(segments, width);

  // `choice[k]` is the index into `candidates.head`/`dir` (not segment-local)
  // currently selected for segment k. Randomized rather than always the
  // first candidate, so a re-run with a fresh rng draw is not stuck
  // re-exploring the same starting point.
  const choice = new Uint32Array(segmentCount);
  for (let k = 0; k < segmentCount; k++) {
    const from = candidates.candStart[k] as number;
    const arity = (candidates.candStart[k + 1] as number) - from;
    choice[k] = from + rng.int(arity);
  }

  const segHead = new Uint32Array(segmentCount);
  const segDir = new Uint8Array(segmentCount);
  const segReversed = new Uint8Array(segmentCount);
  for (let k = 0; k < segmentCount; k++)
    applyOne(k, choice, candidates, segHead, segDir, segReversed);

  const graphInput: BlockingGraphInput = {
    width,
    height,
    segmentCount,
    occupancy,
    segHead,
    segDir,
  };

  const rows = toRows(buildBlockingGraph(graphInput), segmentCount);
  let csr = rowsToCsr(rows, segmentCount);
  let tarjan = tarjanSCC(csr);
  const initialSccCount = countCyclicComponents(csr, tarjan);

  let cyclic = collectCyclic(csr, tarjan);
  let iterations = 0;

  while (cyclic.length > 0 && iterations < maxIterations) {
    const pick = cyclic[rng.int(cyclic.length)] as number;
    flipCandidate(rng, candidates.candStart, choice, pick);
    iterations++;

    applyOne(pick, choice, candidates, segHead, segDir, segReversed);
    // Only `pick`'s own ray can have changed - see incrementalRow.ts.
    rows[pick] = recomputeRow(
      pick + 1,
      segHead[pick] as number,
      segDir[pick] as Direction,
      occupancy,
      width,
      height,
    );
    csr = rowsToCsr(rows, segmentCount);
    tarjan = tarjanSCC(csr);
    cyclic = collectCyclic(csr, tarjan);
  }

  const converged = cyclic.length === 0;
  return {
    segHead,
    segDir,
    segReversed,
    converged,
    iterations,
    flips: iterations,
    initialSccCount,
    finalSccCount: converged ? 0 : countCyclicComponents(csr, tarjan),
  };
}

function applyOne(
  k: number,
  choice: Uint32Array,
  candidates: HeadCandidates,
  outHead: Uint32Array,
  outDir: Uint8Array,
  outReversed: Uint8Array,
): void {
  const j = choice[k] as number;
  outHead[k] = candidates.head[j] as number;
  outDir[k] = candidates.dir[j] as number;
  outReversed[k] = candidates.reversed[j] as number;
}

/**
 * Replace segment `k`'s selected candidate with a different one, uniformly at
 * random among the others (there is nothing to flip *to* for a length-1
 * segment's 4-way choice unless "different from current" is the rule, the
 * same way it is for the ordinary 2-way case).
 */
function flipCandidate(rng: Rng, candStart: Uint32Array, choice: Uint32Array, k: number): void {
  const from = candStart[k] as number;
  const arity = (candStart[k + 1] as number) - from;
  if (arity <= 1) return; // nothing else to choose; cannot happen for a real segment
  const currentLocal = (choice[k] as number) - from;
  let nextLocal = rng.int(arity - 1);
  if (nextLocal >= currentLocal) nextLocal++;
  choice[k] = from + nextLocal;
}

/** Per-segment blocker lists (0-based array index, 1-based ids inside), read off a fresh CSR build. */
function toRows(graph: BlockingGraph, segmentCount: number): Uint32Array[] {
  const rows: Uint32Array[] = new Array<Uint32Array>(segmentCount);
  for (let id = 1; id <= segmentCount; id++) {
    const from = graph.edgeStart[id - 1] as number;
    const to = graph.edgeStart[id] as number;
    rows[id - 1] = graph.edgeTarget.slice(from, to);
  }
  return rows;
}

/** Flatten per-segment rows (1-based ids) into the 0-based CSR Tarjan expects. */
function rowsToCsr(rows: readonly Uint32Array[], segmentCount: number): CsrGraph {
  const edgeStart = new Uint32Array(segmentCount + 1);
  let total = 0;
  for (const row of rows) total += row.length;
  const edgeTarget = new Uint32Array(total);
  let at = 0;
  for (let k = 0; k < segmentCount; k++) {
    edgeStart[k] = at;
    for (const target of rows[k] as Uint32Array) edgeTarget[at++] = target - 1;
  }
  edgeStart[segmentCount] = at;
  return { nodeCount: segmentCount, edgeStart, edgeTarget };
}

function collectCyclic(graph: CsrGraph, result: ReturnType<typeof tarjanSCC>): number[] {
  const flags = cyclicNodes(graph, result);
  const list: number[] = [];
  for (let v = 0; v < graph.nodeCount; v++) if (flags[v] === 1) list.push(v);
  return list;
}
