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
 * Every flip requires a genuinely global recheck - acyclicity is a property
 * of the whole graph, not of the flipped node alone - so Tarjan runs in
 * full every iteration; there is no way to check "did this flip fix it"
 * more cheaply than that. What *is* local to the flip is which row of the
 * blocking digraph can have changed: occupancy (which cells belong to which
 * segment) never changes, only where the flipped segment's own ray starts
 * and which way it points, so only that segment's own row can differ (see
 * incrementalRow.ts). The graph is therefore kept as one CSR buffer with
 * slack reserved per row, so a flip overwrites its own row's slot in place
 * (`tryUpdateRow` below) instead of re-flattening every row's content into a
 * fresh array on every iteration - `Tarjan`'s own working arrays are reused
 * across calls the same way, via `TarjanScratch`.
 */

import type { Rng } from '../rng.js';
import type { Direction } from '../types.js';
import type { SegmentedPath } from '../segment/segmentPath.js';
import { buildBlockingGraph } from './blocking.js';
import type { BlockingGraph, BlockingGraphInput } from './blocking.js';
import { computeHeadCandidates } from './headOptions.js';
import type { HeadCandidates } from './headOptions.js';
import { recomputeRow } from './incrementalRow.js';
import { createTarjanScratch, cyclicNodes, tarjanSCC } from './tarjan.js';
import type { CsrGraph, TarjanResult, TarjanScratch } from './tarjan.js';

/**
 * A time budget, not a convergence target - and an unresolved one. On the
 * trivial boustrophedon fixture (`makePath`) this converges reliably even
 * at 100x100; on a real spanning-tree contour path (`buildContourPath`,
 * landed since this issue's brief was written) it very rarely does at any
 * size this issue measured, because a bendy real path packs segments into a
 * far denser blocking graph - which also makes each iteration itself
 * costlier, not just convergence rarer. Growing this box does not fix that
 * within a 1s generation budget: this issue's report has the numbers for
 * both path sources, and picking a properly-tuned value (likely
 * segmentCount- or density-aware, not a flat constant) needs the real
 * generator pipeline and harness this issue does not have access to. Until
 * then, reverse construction (#11) is not a rare fallback - on real
 * geometry it is close to the default outcome.
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

/**
 * A blocking digraph stored with slack: `capacity[k]` slots are reserved for
 * segment `k`'s row starting at `edgeStart[k]`, of which `edgeCount[k]` are
 * currently used (0-based ids, matching `CsrGraph`). A flip that does not
 * grow its row past its reserved capacity is a plain in-place overwrite of
 * that row's slots - every other row's bytes are untouched, so no
 * whole-graph flatten is needed to keep `edgeTarget` valid.
 */
interface SlackCsr {
  edgeStart: Uint32Array;
  edgeTarget: Uint32Array;
  edgeCount: Uint32Array;
  capacity: Uint32Array;
}

/** Extra room reserved per row so an ordinary flip (row shrinks or grows a little) never forces a rebuild. */
function reserveCapacity(len: number): number {
  return Math.max(8, len * 2);
}

function buildSlackCsr(blocking: BlockingGraph, segmentCount: number): SlackCsr {
  const capacity = new Uint32Array(segmentCount);
  const edgeStart = new Uint32Array(segmentCount + 1);
  const edgeCount = new Uint32Array(segmentCount);
  let total = 0;
  for (let id = 1; id <= segmentCount; id++) {
    const len = (blocking.edgeStart[id] as number) - (blocking.edgeStart[id - 1] as number);
    const cap = reserveCapacity(len);
    capacity[id - 1] = cap;
    edgeStart[id - 1] = total;
    edgeCount[id - 1] = len;
    total += cap;
  }
  edgeStart[segmentCount] = total;

  const edgeTarget = new Uint32Array(total);
  for (let id = 1; id <= segmentCount; id++) {
    const from = blocking.edgeStart[id - 1] as number;
    const len = edgeCount[id - 1] as number;
    const dst = edgeStart[id - 1] as number;
    for (let i = 0; i < len; i++)
      edgeTarget[dst + i] = (blocking.edgeTarget[from + i] as number) - 1;
  }
  return { edgeStart, edgeTarget, edgeCount, capacity };
}

/**
 * Overwrite segment `pick`'s row (0-based `k = pick`) with `row` (1-based
 * ids, sorted, from `recomputeRow`). Returns false without touching
 * anything when `row` no longer fits the reserved slot - the caller falls
 * back to a full rebuild in that (rare) case.
 */
function tryUpdateRow(slack: SlackCsr, k: number, row: Uint32Array): boolean {
  if (row.length > (slack.capacity[k] as number)) return false;
  const dst = slack.edgeStart[k] as number;
  for (let i = 0; i < row.length; i++) slack.edgeTarget[dst + i] = (row[i] as number) - 1;
  slack.edgeCount[k] = row.length;
  return true;
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

  // Orientation bit per segment: index into `candidates.head`/`dir`/`reversed`
  // (not segment-local). Randomized rather than always the first candidate,
  // so a re-run with a fresh rng draw is not stuck re-exploring the same
  // starting point.
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

  let slack = buildSlackCsr(buildBlockingGraph(graphInput), segmentCount);
  const tarjanScratch: TarjanScratch = createTarjanScratch(segmentCount);
  const cyclicFlags = new Uint8Array(segmentCount);
  const cyclicList = new Uint32Array(segmentCount);

  const runTarjan = (): TarjanResult => tarjanSCC(asCsrGraph(slack, segmentCount), tarjanScratch);
  const collectCyclicCount = (graph: CsrGraph, result: TarjanResult): number => {
    cyclicNodes(graph, result, { skipSelfLoopScan: true, out: cyclicFlags });
    let count = 0;
    for (let v = 0; v < segmentCount; v++) if (cyclicFlags[v] === 1) cyclicList[count++] = v;
    return count;
  };

  let tarjan = runTarjan();
  let cyclicCount = collectCyclicCount(asCsrGraph(slack, segmentCount), tarjan);
  // cyclicFlags is only valid to read *after* collectCyclicCount has populated
  // it for the current tarjan result - computing this before that call (as an
  // earlier version of this function did) always reads a stale, freshly
  // zeroed buffer and silently reports 0.
  const initialSccCount = countDistinctCyclicComponents(cyclicFlags, tarjan, segmentCount);
  let iterations = 0;

  while (cyclicCount > 0 && iterations < maxIterations) {
    const pick = cyclicList[rng.int(cyclicCount)] as number;
    flipCandidate(rng, candidates.candStart, choice, pick);
    iterations++;

    applyOne(pick, choice, candidates, segHead, segDir, segReversed);
    // Only `pick`'s own ray can have changed - see incrementalRow.ts.
    const row = recomputeRow(
      pick + 1,
      segHead[pick] as number,
      segDir[pick] as Direction,
      occupancy,
      width,
      height,
    );
    if (!tryUpdateRow(slack, pick, row)) {
      // Rare: pick's blocker count outgrew its reserved slack. Rebuilding
      // from a fresh full scan is correctness-safe and self-healing - the
      // new reservation is sized off the row that just overflowed, so the
      // same segment does not repeatedly force this path.
      slack = buildSlackCsr(buildBlockingGraph(graphInput), segmentCount);
    }

    tarjan = runTarjan();
    cyclicCount = collectCyclicCount(asCsrGraph(slack, segmentCount), tarjan);
  }

  const converged = cyclicCount === 0;
  return {
    segHead,
    segDir,
    segReversed,
    converged,
    iterations,
    flips: iterations,
    initialSccCount,
    finalSccCount: converged ? 0 : countDistinctCyclicComponents(cyclicFlags, tarjan, segmentCount),
  };
}

function asCsrGraph(slack: SlackCsr, segmentCount: number): CsrGraph {
  return {
    nodeCount: segmentCount,
    edgeStart: slack.edgeStart,
    edgeTarget: slack.edgeTarget,
    edgeCount: slack.edgeCount,
  };
}

/** `cyclicFlags` must already be `cyclicNodes`'s output for `result`. */
function countDistinctCyclicComponents(
  cyclicFlags: Uint8Array,
  result: TarjanResult,
  segmentCount: number,
): number {
  const seen = new Set<number>();
  for (let v = 0; v < segmentCount; v++) {
    if (cyclicFlags[v] === 1) seen.add(result.comp[v] as number);
  }
  return seen.size;
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
