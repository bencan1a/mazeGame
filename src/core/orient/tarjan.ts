/**
 * Iterative Tarjan strongly-connected-components.
 *
 * Iterative rather than recursive: the natural recursion is one frame per node
 * on the current DFS path, which a long dependency chain reaches.
 *
 * Nodes are 0-based indices, not `SegmentId`s — this module knows only about a
 * CSR graph. Callers holding 1-based ids adapt.
 *
 * `TarjanScratch` lets a hot-loop caller reuse its working arrays; ordinary
 * callers can ignore it.
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

/** Sized once per `nodeCount`, then reset rather than reallocated per call. */
export interface TarjanScratch {
  readonly nodeCount: number;
  readonly index: Int32Array;
  readonly lowlink: Int32Array;
  readonly onStack: Uint8Array;
  readonly comp: Int32Array;
  /** Tarjan's "S". Every node is pushed at most once. */
  readonly nodeStack: Uint32Array;
  /** Explicit DFS call stack, one frame per node. */
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
 * Component ids are assigned as each SCC finishes, which is a reverse
 * topological order of the condensation: for any edge `u -> v` with
 * `comp[u] !== comp[v]`, `comp[u] > comp[v]`.
 *
 * The returned `TarjanResult` is a fresh snapshot even when `scratch` is
 * reused, so it stays valid after the next call overwrites the scratch.
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
      // lowlink into the parent that pushed it.
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
   * Skip the self-loop scan. Defaults to false, which is always correct; set
   * true only when self-loop-freedom follows from how `graph` was built, not
   * from having observed it on some inputs.
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
