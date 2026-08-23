/**
 * Randomized local search for an acyclic head assignment: find the SCCs, flip
 * a segment inside a non-trivial one, recheck.
 *
 * Boxed by iteration count, not wall-clock time — a millisecond budget would
 * make the same seed converge or not depending on the machine.
 *
 * Acyclicity is a property of the whole graph, so every flip needs a full
 * Tarjan run. What is local to a flip is which *row* can have changed:
 * occupancy never moves, only where the flipped segment's ray starts and
 * points, so only its own row differs. The graph is therefore one CSR buffer
 * with slack per row, and a flip overwrites its row in place.
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
 * A budget, not a convergence target, and an untuned one. On a boustrophedon
 * fixture this converges reliably; on a real contour path it rarely does, so
 * reverse construction is close to the default outcome rather than a rare
 * fallback. A tuned value is likely density-aware rather than a flat constant.
 */
export const DEFAULT_MAX_ITERATIONS = 2000;

export interface LocalSearchStats {
  readonly converged: boolean;
  /** Flips attempted before converging or giving up. */
  readonly iterations: number;
  /** Equal to `iterations` here, one flip per iteration. */
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
 * A blocking digraph stored with slack: `capacity[k]` slots reserved for
 * segment `k`'s row at `edgeStart[k]`, of which `edgeCount[k]` are used
 * (0-based ids). A row that grows within its capacity is overwritten in place,
 * leaving every other row's bytes untouched.
 */
interface SlackCsr {
  edgeStart: Uint32Array;
  edgeTarget: Uint32Array;
  edgeCount: Uint32Array;
  capacity: Uint32Array;
}

/** Extra room per row, so an ordinary flip does not force a rebuild. */
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

  // Index into `candidates.head`/`dir`/`reversed`, not segment-local.
  // Randomized so a re-run with a fresh rng draw starts somewhere else.
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
  // cyclicFlags is only valid after collectCyclicCount has populated it for
  // the current tarjan result; read earlier it is a stale zeroed buffer.
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
      // pick's blocker count outgrew its reserved slack. The rebuild sizes the
      // new reservation off the row that overflowed, so the same segment does
      // not force this path repeatedly.
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
 * random among the others — "different from current" being the rule for the
 * length-1 segment's 4-way choice as much as the ordinary 2-way one.
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
