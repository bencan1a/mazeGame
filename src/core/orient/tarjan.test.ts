import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { countCyclicComponents, createTarjanScratch, cyclicNodes, tarjanSCC } from './tarjan.js';
import type { CsrGraph } from './tarjan.js';

/** Build a CsrGraph from an adjacency list, edges in the given per-node order. */
function graphOf(nodeCount: number, edges: readonly (readonly number[])[]): CsrGraph {
  const edgeStart = new Uint32Array(nodeCount + 1);
  let total = 0;
  for (const row of edges) total += row.length;
  const edgeTarget = new Uint32Array(total);
  let at = 0;
  for (let v = 0; v < nodeCount; v++) {
    edgeStart[v] = at;
    for (const w of edges[v] ?? []) edgeTarget[at++] = w;
  }
  edgeStart[nodeCount] = at;
  return { nodeCount, edgeStart, edgeTarget };
}

describe('trivial SCCs: a DAG has one component per node', () => {
  it('a chain 0 -> 1 -> 2 -> 3 yields four size-1 components', () => {
    const graph = graphOf(4, [[1], [2], [3], []]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(4);
    for (const size of result.componentSize) expect(size).toBe(1);
    expect(Array.from(cyclicNodes(graph, result))).toEqual([0, 0, 0, 0]);
  });

  it('a diamond (0 -> 1, 0 -> 2, 1 -> 3, 2 -> 3) is still all size-1 components', () => {
    const graph = graphOf(4, [[1, 2], [3], [3], []]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(4);
    expect(countCyclicComponents(graph, result)).toBe(0);
  });

  it('an edgeless graph is n components of size 1', () => {
    const graph = graphOf(5, [[], [], [], [], []]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(5);
    expect(new Set(result.comp).size).toBe(5);
  });
});

describe('a single cycle is one non-trivial component', () => {
  it('a 2-cycle (0 <-> 1) merges into one component of size 2', () => {
    const graph = graphOf(2, [[1], [0]]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(1);
    expect(Array.from(result.componentSize)).toEqual([2]);
    expect(Array.from(cyclicNodes(graph, result))).toEqual([1, 1]);
  });

  it('a 3-cycle (0 -> 1 -> 2 -> 0) merges into one component of size 3', () => {
    const graph = graphOf(3, [[1], [2], [0]]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(1);
    expect(Array.from(result.componentSize)).toEqual([3]);
  });
});

describe('self-loops', () => {
  it('a node with an edge to itself is its own size-1 component, but flagged cyclic', () => {
    const graph = graphOf(3, [[0], [], []]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(3);
    for (const size of result.componentSize) expect(size).toBe(1); // does not merge with anything
    expect(Array.from(cyclicNodes(graph, result))).toEqual([1, 0, 0]);
    expect(countCyclicComponents(graph, result)).toBe(1);
  });

  it('a self-loop inside a larger cycle does not change the component count', () => {
    const graph = graphOf(3, [[0, 1], [2], [0]]); // 0 self-loops and also feeds the 0-1-2 cycle
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(1);
    expect(Array.from(result.componentSize)).toEqual([3]);
  });
});

describe('nested / chained SCCs', () => {
  it('two disjoint cycles joined by a bridge edge condense into two ordered components', () => {
    // Cycle A: 0 <-> 1. Cycle B: 2 <-> 3. Bridge: 0 -> 2 (A depends on B).
    const graph = graphOf(4, [[1, 2], [0], [3], [2]]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(2);
    expect(result.comp[0]).toBe(result.comp[1]);
    expect(result.comp[2]).toBe(result.comp[3]);
    expect(result.comp[0]).not.toBe(result.comp[2]);
    // B is discovered as finished before A, since A's bridge edge reaches into B first.
    expect(result.comp[0] as number).toBeGreaterThan(result.comp[2] as number);
    expect(countCyclicComponents(graph, result)).toBe(2);
  });

  it('a chain of three cycles (A -> B -> C) condenses into three components in dependency order', () => {
    const graph = graphOf(6, [
      [1, 2], // A: 0 <-> 1, bridging to B at 2
      [0],
      [3, 4], // B: 2 <-> 3, bridging to C at 4
      [2],
      [5], // C: 4 <-> 5
      [4],
    ]);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(3);
    const compA = result.comp[0] as number;
    const compB = result.comp[2] as number;
    const compC = result.comp[4] as number;
    expect(new Set([compA, compB, compC]).size).toBe(3);
    expect(compA).toBeGreaterThan(compB);
    expect(compB).toBeGreaterThan(compC);
  });
});

describe('a single big SCC', () => {
  it('a cycle spanning every node is one component covering the whole graph', () => {
    const n = 50;
    const edges = Array.from({ length: n }, (_, i) => [(i + 1) % n]);
    const graph = graphOf(n, edges);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(1);
    expect(result.componentSize[0]).toBe(n);
  });
});

describe('iterative implementation does not recurse-blow the stack', () => {
  it('handles a long chain of 20000 nodes', () => {
    const n = 20000;
    const edges = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : []));
    const graph = graphOf(n, edges);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(n);
  });

  it('handles a single SCC of 20000 nodes (worst case for the explicit stack)', () => {
    const n = 20000;
    const edges = Array.from({ length: n }, (_, i) => [(i + 1) % n]);
    const graph = graphOf(n, edges);
    const result = tarjanSCC(graph);
    expect(result.componentCount).toBe(1);
    expect(result.componentSize[0]).toBe(n);
  });
});

describe('property: condensation respects edge direction', () => {
  const graphArb = fc.integer({ min: 1, max: 12 }).chain((nodeCount) =>
    fc.record({
      nodeCount: fc.constant(nodeCount),
      edges: fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: nodeCount - 1 }),
          fc.integer({ min: 0, max: nodeCount - 1 }),
        ),
        { maxLength: nodeCount * 4 },
      ),
    }),
  );

  it('for every edge u -> v in different components, comp[u] > comp[v] (reverse topological order)', () => {
    fc.assert(
      fc.property(graphArb, ({ nodeCount, edges }) => {
        const perNode: number[][] = Array.from({ length: nodeCount }, () => []);
        for (const [u, v] of edges) (perNode[u] as number[]).push(v);
        const graph = graphOf(nodeCount, perNode);
        const result = tarjanSCC(graph);

        expect(result.comp.length).toBe(nodeCount);
        expect(result.componentSize.length).toBe(result.componentCount);
        expect(Array.from(result.componentSize).reduce((a, b) => a + b, 0)).toBe(nodeCount);

        for (const [u, v] of edges) {
          if (result.comp[u] !== result.comp[v]) {
            expect(result.comp[u] as number).toBeGreaterThan(result.comp[v] as number);
          }
        }
      }),
    );
  });

  it('every node with a self-loop is flagged cyclic, and no node without one is flagged solely for that reason', () => {
    fc.assert(
      fc.property(graphArb, ({ nodeCount, edges }) => {
        const perNode: number[][] = Array.from({ length: nodeCount }, () => []);
        for (const [u, v] of edges) (perNode[u] as number[]).push(v);
        const graph = graphOf(nodeCount, perNode);
        const result = tarjanSCC(graph);
        const flags = cyclicNodes(graph, result);

        for (let v = 0; v < nodeCount; v++) {
          const hasSelfLoop = (perNode[v] as number[]).includes(v);
          const inBigComponent = (result.componentSize[result.comp[v] as number] as number) > 1;
          expect(flags[v]).toBe(hasSelfLoop || inBigComponent ? 1 : 0);
        }
      }),
    );
  });
});

describe('property: matches a brute-force reachability ground truth', () => {
  // The reverse-topological-order property above only inspects edges where
  // comp[u] !== comp[v] - the classic Tarjan bug (over-merging two distinct
  // SCCs into one) never produces such an edge to inspect, so that property
  // cannot catch it: the size-sum still equals n, and it would pass silently.
  // Mutual reachability, computed independently by brute-force transitive
  // closure, is the actual definition of "same SCC" and catches over- and
  // under-merging both. Cheap enough to brute-force up to ~12 nodes.
  const graphArb = fc.integer({ min: 1, max: 12 }).chain((nodeCount) =>
    fc.record({
      nodeCount: fc.constant(nodeCount),
      edges: fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: nodeCount - 1 }),
          fc.integer({ min: 0, max: nodeCount - 1 }),
        ),
        { maxLength: nodeCount * 4 },
      ),
    }),
  );

  function reachabilityClosure(nodeCount: number, perNode: readonly number[][]): boolean[][] {
    const reach: boolean[][] = Array.from({ length: nodeCount }, () =>
      new Array<boolean>(nodeCount).fill(false),
    );
    for (let v = 0; v < nodeCount; v++) reach[v]![v] = true;
    for (let u = 0; u < nodeCount; u++) {
      for (const v of perNode[u] ?? []) reach[u]![v] = true;
    }
    for (let k = 0; k < nodeCount; k++) {
      for (let i = 0; i < nodeCount; i++) {
        if (!reach[i]![k]) continue;
        for (let j = 0; j < nodeCount; j++) {
          if (reach[k]![j]) reach[i]![j] = true;
        }
      }
    }
    return reach;
  }

  it('comp[u] === comp[v] iff u and v are mutually reachable', () => {
    fc.assert(
      fc.property(graphArb, ({ nodeCount, edges }) => {
        const perNode: number[][] = Array.from({ length: nodeCount }, () => []);
        for (const [u, v] of edges) (perNode[u] as number[]).push(v);
        const graph = graphOf(nodeCount, perNode);
        const result = tarjanSCC(graph);
        const reach = reachabilityClosure(nodeCount, perNode);

        for (let u = 0; u < nodeCount; u++) {
          for (let v = 0; v < nodeCount; v++) {
            const sameComponent = result.comp[u] === result.comp[v];
            const mutuallyReachable =
              (reach[u] as boolean[])[v] === true && (reach[v] as boolean[])[u] === true;
            expect(sameComponent).toBe(mutuallyReachable);
          }
        }
      }),
    );
  });
});

describe('TarjanScratch: reusing scratch across calls gives the same answer as fresh allocation', () => {
  it('over a sequence of unrelated graphs of the same nodeCount', () => {
    const nodeCount = 8;
    const graphs: CsrGraph[] = [
      graphOf(nodeCount, [[1], [2], [0], [4], [5], [3], [], []]), // one 3-cycle, one 3-cycle, two isolated
      graphOf(nodeCount, [[1, 2], [3], [3], [], [5], [6], [7], [4]]), // a DAG feeding a 4-cycle
      graphOf(nodeCount, [[], [], [], [], [], [], [], []]), // edgeless
    ];

    const scratch = createTarjanScratch(nodeCount);
    for (const graph of graphs) {
      const fresh = tarjanSCC(graph);
      const reused = tarjanSCC(graph, scratch);
      expect(Array.from(reused.comp)).toEqual(Array.from(fresh.comp));
      expect(reused.componentCount).toBe(fresh.componentCount);
      expect(Array.from(reused.componentSize)).toEqual(Array.from(fresh.componentSize));
    }
  });

  it('throws if the scratch was sized for a different nodeCount', () => {
    const scratch = createTarjanScratch(5);
    const graph = graphOf(6, [[1], [2], [3], [4], [5], []]);
    expect(() => tarjanSCC(graph, scratch)).toThrow(/sized for 5 nodes, graph has 6/);
  });
});

describe('CsrGraph with edgeCount (slack): matches the equivalent tight CSR', () => {
  it('a graph with reserved-but-unused capacity per row yields identical SCCs', () => {
    // Same 3-cycle-plus-isolated-nodes graph as the tight-CSR case above, but
    // every row is given extra reserved slots (garbage past edgeCount) that
    // must be ignored.
    const nodeCount = 5;
    const edgeStart = Uint32Array.from([0, 4, 8, 12, 16, 20]); // capacity 4 per row
    const edgeCount = Uint32Array.from([1, 1, 1, 0, 0]); // 0 -> 1 -> 2 -> 0, 3 and 4 isolated
    const edgeTarget = new Uint32Array(20).fill(0xdeadbeef & 0xffff); // garbage in the slack
    edgeTarget[0] = 1; // row 0's one real edge
    edgeTarget[4] = 2; // row 1's one real edge
    edgeTarget[8] = 0; // row 2's one real edge
    const slackGraph: CsrGraph = { nodeCount, edgeStart, edgeTarget, edgeCount };

    const tightGraph = graphOf(nodeCount, [[1], [2], [0], [], []]);

    const slackResult = tarjanSCC(slackGraph);
    const tightResult = tarjanSCC(tightGraph);
    expect(Array.from(slackResult.comp)).toEqual(Array.from(tightResult.comp));
    expect(slackResult.componentCount).toBe(tightResult.componentCount);
    expect(Array.from(slackResult.componentSize)).toEqual(Array.from(tightResult.componentSize));

    expect(Array.from(cyclicNodes(slackGraph, slackResult))).toEqual([1, 1, 1, 0, 0]);
  });
});

describe('cyclicNodes options', () => {
  it('skipSelfLoopScan omits the self-loop check (only safe when the caller knows there are none)', () => {
    const graph = graphOf(3, [[0], [], []]); // node 0 has a self-loop
    const result = tarjanSCC(graph);
    expect(Array.from(cyclicNodes(graph, result))).toEqual([1, 0, 0]);
    expect(Array.from(cyclicNodes(graph, result, { skipSelfLoopScan: true }))).toEqual([0, 0, 0]);
  });

  it('out reuses the supplied buffer instead of allocating', () => {
    const graph = graphOf(2, [[1], [0]]);
    const result = tarjanSCC(graph);
    const buffer = new Uint8Array(2);
    const flags = cyclicNodes(graph, result, { out: buffer });
    expect(flags).toBe(buffer);
    expect(Array.from(buffer)).toEqual([1, 1]);
  });
});
