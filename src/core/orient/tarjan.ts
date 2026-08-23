/**
 * Iterative Tarjan strongly-connected-components, for the orientation local
 * search (issue #10, PRD §4.2 step 4).
 *
 * Iterative rather than recursive on purpose: a 100x100 board can carry
 * thousands of segments, and Tarjan's natural recursion is one stack frame
 * per node on the current DFS path, which is exactly the depth a long
 * dependency chain would hit. `src/core/path/spanningTree.ts` faces the same
 * hazard and solves it the same way - an explicit stack standing in for the
 * call stack.
 *
 * Nodes are plain 0-based indices here, not `SegmentId`s: this module knows
 * nothing about segments or blocking, only about a CSR graph, so it is
 * testable (and reusable) on its own. The orientation search adapts a
 * `BlockingGraph` (1-based ids) into this shape.
 *
 * The local search (localSearch.ts) calls this tens of thousands of times
 * per board - once per candidate flip, because acyclicity is a global
 * property that a single flip can only be *checked* against globally, not
 * updated incrementally. `TarjanScratch` lets that caller reuse its working
 * arrays across calls instead of paying a fresh O(n) allocation every time;
 * ordinary callers (tests, one-off use) can ignore it entirely.
 */

export interface CsrGraph {
  readonly nodeCount: number;
  /** Length nodeCount + 1. */
  readonly edgeStart: Uint32Array;
  /** 0-based node indices. */
  readonly edgeTarget: Uint32Array;
  /**
   * Optional per-node used-length, for a caller that reserves slack in
   * `edgeTarget` so it can overwrite one node's row in place instead of
   * re-flattening the whole graph. When present, node `v`'s edges are
   * `edgeTarget[edgeStart[v] .. edgeStart[v] + edgeCount[v])` instead of
   * `edgeTarget[edgeStart[v] .. edgeStart[v + 1])`. Absent means tight CSR,
   * the ordinary case.
   */
  readonly edgeCount?: Uint32Array;
}

export interface TarjanResult {
  /** Component id per node, 0-based. */
  readonly comp: Uint32Array;
  readonly componentCount: number;
  /** Size of component `c`, indexed by component id. */
  readonly componentSize: Uint32Array;
}

/** Reusable working arrays for `tarjanSCC`, sized once per `nodeCount` and reset (not reallocated) on every call. */
export interface TarjanScratch {
  readonly nodeCount: number;
  readonly index: Int32Array;
  readonly lowlink: Int32Array;
  readonly onStack: Uint8Array;
  readonly comp: Int32Array;
  /** Tarjan's "S": every node pushed at most once, so capacity `nodeCount` always suffices. */
  readonly nodeStack: Uint32Array;
  /** Explicit DFS call stack: depth is bounded by `nodeCount` (one frame per node). */
  readonly frameNode: Uint32Array;
  readonly frameEdgePos: Uint32Array;
  readonly componentSize: Uint32Array;
}

export function createTarjanScratch(nodeCount: number): TarjanScratch {
  return {
    nodeCount,
    index: new Int32Array(nodeCount),
    lowlink: new Int32Array(nodeCount),
    onStack: new Uint8Array(nodeCount),
    comp: new Int32Array(nodeCount),
    nodeStack: new Uint32Array(nodeCount),
    frameNode: new Uint32Array(nodeCount),
    frameEdgePos: new Uint32Array(nodeCount),
    componentSize: new Uint32Array(nodeCount),
  };
}

function rowEnd(graph: CsrGraph, v: number): number {
  return graph.edgeCount !== undefined
    ? (graph.edgeStart[v] as number) + (graph.edgeCount[v] as number)
    : (graph.edgeStart[v + 1] as number);
}

/**
 * Standard Tarjan, run iteratively. Component ids are assigned in the order
 * each SCC finishes, which is a reverse topological order of the condensation:
 * for any edge `u -> v` with `comp[u] !== comp[v]`, `comp[u] > comp[v]`.
 *
 * `scratch` (from `createTarjanScratch`) lets a hot-loop caller skip the
 * per-call allocation of `index`/`lowlink`/`onStack`/the two DFS stacks; the
 * returned `TarjanResult` is always a fresh, independent snapshot regardless
 * (a small O(n) copy) so it stays safe to hold onto after the next call
 * reuses and overwrites the scratch.
 */
export function tarjanSCC(graph: CsrGraph, scratch?: TarjanScratch): TarjanResult {
  const n = graph.nodeCount;
  const s = scratch ?? createTarjanScratch(n);
  if (s.nodeCount !== n) {
    throw new Error(`tarjan scratch is sized for ${s.nodeCount} nodes, graph has ${n}`);
  }

  const { index, lowlink, onStack, comp, nodeStack, frameNode, frameEdgePos, componentSize } = s;
  index.fill(-1);
  comp.fill(-1);
  onStack.fill(0);
  let nodeStackTop = 0;
  let frameTop = 0;
  let nextIndex = 0;
  let componentCount = 0;

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;

    index[root] = nextIndex;
    lowlink[root] = nextIndex;
    nextIndex++;
    nodeStack[nodeStackTop] = root;
    nodeStackTop++;
    onStack[root] = 1;
    frameNode[frameTop] = root;
    frameEdgePos[frameTop] = graph.edgeStart[root] as number;
    frameTop++;

    while (frameTop > 0) {
      const v = frameNode[frameTop - 1] as number;
      const pos = frameEdgePos[frameTop - 1] as number;
      const end = rowEnd(graph, v);

      if (pos < end) {
        frameEdgePos[frameTop - 1] = pos + 1;
        const w = graph.edgeTarget[pos] as number;
        if (index[w] === -1) {
          index[w] = nextIndex;
          lowlink[w] = nextIndex;
          nextIndex++;
          nodeStack[nodeStackTop] = w;
          nodeStackTop++;
          onStack[w] = 1;
          frameNode[frameTop] = w;
          frameEdgePos[frameTop] = graph.edgeStart[w] as number;
          frameTop++;
        } else if (onStack[w] === 1) {
          if ((index[w] as number) < (lowlink[v] as number)) lowlink[v] = index[w] as number;
        }
        continue;
      }

      // v's edges are exhausted: pop its frame and, for a tree edge, fold its
      // lowlink into the parent that pushed it - the step a recursive
      // implementation takes right after the recursive call returns.
      frameTop--;
      if (frameTop > 0) {
        const parent = frameNode[frameTop - 1] as number;
        if ((lowlink[v] as number) < (lowlink[parent] as number))
          lowlink[parent] = lowlink[v] as number;
      }

      if (lowlink[v] === index[v]) {
        let size = 0;
        for (;;) {
          nodeStackTop--;
          const w = nodeStack[nodeStackTop] as number;
          onStack[w] = 0;
          comp[w] = componentCount;
          size++;
          if (w === v) break;
        }
        componentSize[componentCount] = size;
        componentCount++;
      }
    }
  }

  return {
    comp: Uint32Array.from(comp.subarray(0, n)),
    componentCount,
    componentSize: Uint32Array.from(componentSize.subarray(0, componentCount)),
  };
}

export interface CyclicNodesOptions {
  /**
   * Skip the self-loop scan (an O(edges) pass) when the caller already knows
   * `graph` cannot contain a self-edge - true of every blocking digraph this
   * module is used with (`buildBlockingGraph`'s own doc comment: a segment's
   * body never blocks itself). Defaults to false (always scan), which is
   * always correct; set true only when self-loop-freedom is a property of
   * how `graph` was built, not merely observed to hold on some inputs.
   */
  readonly skipSelfLoopScan?: boolean;
  /** Reuse this buffer for the output instead of allocating a new `Uint8Array(nodeCount)`. */
  readonly out?: Uint8Array;
}

/**
 * Nodes that cannot be part of a valid removal order: members of an SCC of
 * size > 1, or a node with a self-loop (which Tarjan reports as its own
 * size-1 component - a self-loop never merges with anything else, so it is
 * cyclic without being "non-trivial" by size alone).
 */
export function cyclicNodes(
  graph: CsrGraph,
  result: TarjanResult,
  options: CyclicNodesOptions = {},
): Uint8Array {
  const flag = options.out ?? new Uint8Array(graph.nodeCount);
  flag.fill(0);
  for (let v = 0; v < graph.nodeCount; v++) {
    if ((result.componentSize[result.comp[v] as number] as number) > 1) flag[v] = 1;
  }
  if (options.skipSelfLoopScan === true) return flag;
  for (let v = 0; v < graph.nodeCount; v++) {
    const from = graph.edgeStart[v] as number;
    const to = rowEnd(graph, v);
    for (let k = from; k < to; k++) {
      if (graph.edgeTarget[k] === v) {
        flag[v] = 1;
        break;
      }
    }
  }
  return flag;
}

/** Count of distinct SCCs `cyclicNodes` flags as part of a cycle. */
export function countCyclicComponents(graph: CsrGraph, result: TarjanResult): number {
  const flags = cyclicNodes(graph, result);
  const seen = new Set<number>();
  for (let v = 0; v < graph.nodeCount; v++) {
    if (flags[v] === 1) seen.add(result.comp[v] as number);
  }
  return seen.size;
}
