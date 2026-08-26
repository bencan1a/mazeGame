/**
 * The boundary of a cell mask, as loops that can be smoothed and filled.
 *
 * Scaling a mask up as pixels leaves a staircase no amount of blurring hides:
 * a shallow curve steps once every several cells, and a blur wide enough to
 * swallow that step softens everything else with it. Tracing the boundary and
 * cutting its corners smooths the shape itself instead.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Cell corners, so a loop's coordinates run 0..width and 0..height. */
type Edge = readonly [Point, Point];

function key(point: Point): string {
  return `${point.x},${point.y}`;
}

/**
 * Every edge between an inside cell and what is not one, wound so that inside
 * stays on the same hand throughout. Holes therefore come out wound opposite
 * to the outline around them, which is what lets one fill rule cut them out.
 */
function boundaryEdges(inside: Uint8Array, width: number, height: number): Edge[] {
  const edges: Edge[] = [];
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : (inside[y * width + x] as number);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) !== 1) continue;
      if (at(x, y - 1) !== 1)
        edges.push([
          { x, y },
          { x: x + 1, y },
        ]);
      if (at(x + 1, y) !== 1)
        edges.push([
          { x: x + 1, y },
          { x: x + 1, y: y + 1 },
        ]);
      if (at(x, y + 1) !== 1)
        edges.push([
          { x: x + 1, y: y + 1 },
          { x, y: y + 1 },
        ]);
      if (at(x - 1, y) !== 1)
        edges.push([
          { x, y: y + 1 },
          { x, y },
        ]);
    }
  }
  return edges;
}

/** Closed loops of cell corners. A mask with holes gives one loop per hole as well. */
export function maskLoops(inside: Uint8Array, width: number, height: number): Point[][] {
  const outgoing = new Map<string, Edge[]>();
  for (const edge of boundaryEdges(inside, width, height)) {
    const from = key(edge[0]);
    const list = outgoing.get(from);
    if (list === undefined) outgoing.set(from, [edge]);
    else list.push(edge);
  }

  const loops: Point[][] = [];
  for (const [, edges] of outgoing) {
    while (edges.length > 0) {
      const first = edges.pop() as Edge;
      const loop: Point[] = [first[0]];
      let cursor = first[1];
      // A corner where two diagonal cells meet has two ways out. Either choice
      // closes a loop, and both loops get walked, so the fill is the same.
      while (key(cursor) !== key(first[0])) {
        const next = outgoing.get(key(cursor));
        if (next === undefined || next.length === 0) break;
        const edge = next.pop() as Edge;
        loop.push(edge[0]);
        cursor = edge[1];
      }
      if (loop.length > 2) loops.push(loop);
    }
  }
  return loops;
}

/**
 * Taubin smoothing: a shrinking pass towards each point's neighbours followed
 * by an expanding one that undoes the shrink. Corner cutting alone hugs the
 * staircase it is given — it rounds a jog without removing it — so the jogs
 * have to be averaged out first, and averaging without the second pass would
 * slowly collapse the shape.
 */
export function relaxLoop(loop: readonly Point[], passes: number): Point[] {
  const SHRINK = 0.5;
  const EXPAND = -0.53;
  let current = [...loop];
  if (current.length < 5) return current;
  for (let pass = 0; pass < passes; pass++) {
    current = weight(current, pass % 2 === 0 ? SHRINK : EXPAND);
  }
  return current;
}

function weight(loop: readonly Point[], factor: number): Point[] {
  return loop.map((point, i) => {
    const before = loop[(i - 1 + loop.length) % loop.length] as Point;
    const after = loop[(i + 1) % loop.length] as Point;
    const midX = (before.x + after.x) / 2;
    const midY = (before.y + after.y) / 2;
    return {
      x: point.x + factor * (midX - point.x),
      y: point.y + factor * (midY - point.y),
    };
  });
}

/**
 * Chaikin corner cutting: each pass replaces a corner with the two points a
 * quarter and three quarters along its edges, so a right angle becomes a
 * bevel, then a curve. Three passes take a cell staircase to something that
 * reads as drawn rather than sampled.
 */
export function smoothLoop(loop: readonly Point[], passes: number): Point[] {
  let current = [...loop];
  for (let pass = 0; pass < passes; pass++) {
    const next: Point[] = [];
    for (let i = 0; i < current.length; i++) {
      const a = current[i] as Point;
      const b = current[(i + 1) % current.length] as Point;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    current = next;
  }
  return current;
}

/** Beyond this the shape stops changing and only the small loops suffer. */
const MAX_RELAX_PASSES = 120;
const CORNER_CUTS = 2;

/**
 * A mask boundary, ready to fill as a shape rather than as cells.
 *
 * The number of averaging passes has to grow with the loop: a jog is one cell
 * wherever it appears, so a count that smooths a long outline will pull a
 * short one — a small lobe, an eye — most of the way to its own centre.
 */
export function smoothOutline(loop: readonly Point[]): Point[] {
  const passes = Math.min(MAX_RELAX_PASSES, Math.max(2, Math.round(loop.length / 2)));
  return smoothLoop(relaxLoop(loop, passes), CORNER_CUTS);
}
