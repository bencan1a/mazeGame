# Architecture

Implements PRD §4. Read that first; this file is the map of where things live
and which boundaries are load-bearing.

## Module map

```
src/
  core/            pure generator — no DOM, no React, no clock, no Math.random
    types.ts       the shared contract (see CONTRACTS.md)
    rng.ts         seeded PRNG; the only randomness allowed in core/
    grid.ts        cell-index arithmetic and directions
    mask/          blob -> component -> morphological open -> holes -> parity     [S1]
    path/          spanning-tree contour + backbite Hamiltonian path              [S2]
    segment/       cut the path into segments                                     [S3]
    orient/        blocking digraph, SCC, head assignment, reverse construction   [S3]
    color/         greedy graph coloring over segment adjacency                   [S3]
    validate/      invariant assertions; throws BoardInvariantError               [S4]
    metrics.ts     DAG depth, free-set size, bend rate, coverage                  [S4]
    generate.ts    generateBoard(params) — the single public entry point
  harness/         headless sweep CLI over the generator                          [S4]
  render/          two-layer canvas renderer, pan/zoom, snake-out animation       [S5]
  game/            tap queue, lives, win/lose, persistence                        [S6]
  ui/              React chrome: settings panel, HUD, menus                       [S6]
  pwa/             service-worker registration and install prompt                 [S6]
test/fixtures/     synthetic masks, paths, and boards — the parallelism mechanism
```

Dependency direction is one-way: `ui -> game -> render -> core`. Nothing in
`core/` may import from anything to its left. ESLint enforces it.

## The three rules that are enforced by the build

These are not style preferences. Each one prevents a specific, predicted failure.

### 1. The generator is a pure function of `(seed, params)`

PRD §4.6 calls this the rule most likely to be violated in week two, and
violating it costs the tuning harness — the generator has to be callable
identically from the dev panel, a headless script, and the game loop.

Enforced by ESLint inside `src/core/`: no `react`/`react-dom` imports, no
`window`, no `document`, no `Math.random`, no `Date.now`. See
[adr/0004](./adr/0004-generator-purity.md).

### 2. React never touches the board

React owns chrome only. The canvas lives behind an uncontrolled ref that React
does not re-render into. Re-rendering thousands of pieces through React is the
single most likely performance disaster, so the boundary is structural rather
than careful. See [adr/0002](./adr/0002-canvas-not-svg.md).

### 3. Typed arrays and CSR from day one

At 100×100 the edge count makes per-object overhead fatal. Every array in
`Board` is flat and typed; adjacency is CSR. This is not a retrofit-later
decision — the shapes are fixed in `types.ts` now. See
[adr/0003](./adr/0003-typed-arrays-csr.md).

## Generation pipeline

```
params ──▶ mask ──▶ path ──▶ segmentation ──▶ orientation ──▶ validation ──▶ colors ──▶ Board
           [S1]     [S2]        [S3]             [S3]            [S4]         [S3]
```

Each arrow is a contract in `types.ts`, which is why the stages can be built
concurrently by different agents against fixtures.

**Mask.** Blob → largest connected component → morphological open (erode then
dilate — this is what amputates 1-cell spurs and severs hairline necks, both of
which make a Hamiltonian path impossible) → re-component → fill small holes →
checkerboard parity. A Hamiltonian path needs `|black| − |white| ∈ {0, ±1}`;
any mismatch is absorbed by marking 1–3 cells `unvisited` rather than by editing
the silhouette, which is visually invisible and removes the feasibility problem.

**Path.** Primary is the spanning-tree contour: a random spanning tree on a
half-resolution grid, its outline traced at full resolution. The contour walk
_is_ a Hamiltonian cycle, guaranteed, in linear time — but it requires the
region to tile into 2×2 blocks. Backbite (Mansfield) is the fallback and the
randomizer: take an endpoint, pick a random neighbour, reverse the tail.

**Segmentation.** Cut by `meanPieceLength` and `pieceLengthVariance`, with
`minStraightRun` constraining where cuts may land.

**Orientation.** Each segment has two legal heads, one per endpoint (a one-cell
segment has no terminal stroke, so all four directions are legal for it). Pick an
assignment making the blocking digraph acyclic. This is _not_ 2-SAT — acyclicity
is not a binary clause — so it is randomized local search over Tarjan SCCs, with
reverse construction (slide segments in from the edge; reversed insertion order
is a guaranteed-valid removal order) as the guaranteed fallback. Choosing the far
endpoint reverses the segment, which the orienter must report — see
[CONTRACTS.md](./CONTRACTS.md).

**Validation.** Acyclic, covered, every segment reachable. Fails loudly.

**Colors.** Greedy over segment adjacency, 4–6 hues. Adjacent segments must be
distinguishable or the player cannot tell where one ends and the next begins.
Readability mechanic, not decoration.

## Blocking digraph

For each segment, walk the ray from its head in `segDir` to the board edge,
reading `occupancy` at each step. Every distinct _other_ segment id on that ray
is a blocker; the edge means "blocker must be removed first". A segment's own
body never blocks it.

Because removals only ever unblock, the relation is static: clearing a segment
never creates a dependency. The puzzle is solvable iff the digraph is acyclic,
any greedy order works, and no undo stack is needed.

Cost at 100×100 (~10k cells, ~700 segments at mean length 14) is roughly 700
rays × 50 cells = 35k lookups. Negligible. The binding constraint at the
pathological end is edge _count_, which is what CSR is for.

## Rendering

Two canvas layers:

- **Static** — all idle segments, drawn once to an offscreen canvas at full
  resolution, redrawn only when a segment leaves.
- **Animation** — only the segment currently exiting, redrawn per frame.

Pan and zoom are a single `drawImage` from the offscreen buffer with source and
destination rects. Thousands of segments are never re-rendered per frame.

The snake-out animation concatenates the segment's polyline with its exit ray
into one path and animates the dash offset, with dash length equal to the
segment length — the piece slithers out head-first for the cost of one polyline
per frame.

Hit testing is pixel → cell → `occupancy` → segment id. O(1), no geometry.

**Memory cap:** a 100×100 buffer at 3× zoom is roughly 3000×3000 ≈ 36MB. Fine
on a modern phone, but capped, degrading to re-render rather than crashing
Safari.

## Offline

No network calls during play, ever. Everything is code — no fonts, images, or
audio fetched at runtime — so a service worker precaching the bundle is
sufficient. Board state (`seed`, `params`, removed-segment list, lives) persists
across reload and app kill.

**iOS caveat:** if the app is not added to the home screen, Safari evicts
IndexedDB after ~7 days of non-use and saved progress vanishes silently. That
is why the install path is in scope rather than a nicety.
