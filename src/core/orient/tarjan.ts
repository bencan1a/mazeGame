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
 */

export interface CsrGraph {
  readonly nodeCount: number;
  /** Length nodeCount + 1. */
  readonly edgeStart: Uint32Array;
  /** 0-based node indices. */
  readonly edgeTarget: Uint32Array;
}

export interface TarjanResult {
  /** Component id per node, 0-based. */
  readonly comp: Uint32Array;
  readonly componentCount: number;
  /** Size of component `c`, indexed by component id. */
  readonly componentSize: Uint32Array;
}

/**
 * Standard Tarjan, run iteratively. Component ids are assigned in the order
 * each SCC finishes, which is a reverse topological order of the condensation:
 * for any edge `u -> v` with `comp[u] !== comp[v]`, `comp[u] > comp[v]`.
 */
export function tarjanSCC(graph: CsrGraph): TarjanResult {
  const n = graph.nodeCount;
  const index = new Int32Array(n).fill(-1);
  const lowlink = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const componentSize: number[] = [];
  const nodeStack: number[] = [];
  let nextIndex = 0;
  let componentCount = 0;

  // Explicit DFS call stack: for each open frame, the node and the position
  // in its edge list to resume scanning from.
  const frameNode: number[] = [];
  const frameEdgePos: number[] = [];

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;

    index[root] = nextIndex;
    lowlink[root] = nextIndex;
    nextIndex++;
    nodeStack.push(root);
    onStack[root] = 1;
    frameNode.push(root);
    frameEdgePos.push(graph.edgeStart[root] as number);

    while (frameNode.length > 0) {
      const v = frameNode[frameNode.length - 1] as number;
      const pos = frameEdgePos[frameEdgePos.length - 1] as number;
      const end = graph.edgeStart[v + 1] as number;

      if (pos < end) {
        frameEdgePos[frameEdgePos.length - 1] = pos + 1;
        const w = graph.edgeTarget[pos] as number;
        if (index[w] === -1) {
          index[w] = nextIndex;
          lowlink[w] = nextIndex;
          nextIndex++;
          nodeStack.push(w);
          onStack[w] = 1;
          frameNode.push(w);
          frameEdgePos.push(graph.edgeStart[w] as number);
        } else if (onStack[w] === 1) {
          if ((index[w] as number) < (lowlink[v] as number)) lowlink[v] = index[w] as number;
        }
        continue;
      }

      // v's edges are exhausted: pop its frame and, for a tree edge, fold its
      // lowlink into the parent that pushed it - the step a recursive
      // implementation takes right after the recursive call returns.
      frameNode.pop();
      frameEdgePos.pop();
      if (frameNode.length > 0) {
        const parent = frameNode[frameNode.length - 1] as number;
        if ((lowlink[v] as number) < (lowlink[parent] as number))
          lowlink[parent] = lowlink[v] as number;
      }

      if (lowlink[v] === index[v]) {
        let size = 0;
        for (;;) {
          const w = nodeStack.pop() as number;
          onStack[w] = 0;
          comp[w] = componentCount;
          size++;
          if (w === v) break;
        }
        componentSize.push(size);
        componentCount++;
      }
    }
  }

  return {
    comp: Uint32Array.from(comp),
    componentCount,
    componentSize: Uint32Array.from(componentSize),
  };
}

/**
 * Nodes that cannot be part of a valid removal order: members of an SCC of
 * size > 1, or a node with a self-loop (which Tarjan reports as its own
 * size-1 component - a self-loop never merges with anything else, so it is
 * cyclic without being "non-trivial" by size alone).
 */
export function cyclicNodes(graph: CsrGraph, result: TarjanResult): Uint8Array {
  const flag = new Uint8Array(graph.nodeCount);
  for (let v = 0; v < graph.nodeCount; v++) {
    if ((result.componentSize[result.comp[v] as number] as number) > 1) flag[v] = 1;
  }
  for (let v = 0; v < graph.nodeCount; v++) {
    const from = graph.edgeStart[v] as number;
    const to = graph.edgeStart[v + 1] as number;
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
