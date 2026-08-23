# Arrow Maze — PoC PRD & Technical Design

**Status:** Draft for build kickoff
**Target:** Offline-capable web app, phone-first

---

## 1. The Game

A silhouette (blob, creature, arbitrary shape) is tiled with a single space-filling
path cut into segments. Each segment is a polyline of grid cells with an arrowhead at
one end (the **head**), pointing along its terminal stroke.

Tap a segment:

- **Head's forward ray to the board edge is clear of other segments** → the segment
  snakes out head-first, following its own polyline and then the ray, and leaves the board.
- **Any other segment sits on that ray** → bounce. Lose a life.

A segment's own body never blocks it. Head clear ⇒ guaranteed escape.

Clear every segment to win. Lives hit zero, the board restarts **with the same seed** —
a failed board stays a puzzle you can learn, not a reroll.

### 1.1 Why this is tractable

Removals only ever unblock. Clearing a segment never creates a new dependency, so the
blocking relation is a static digraph and the puzzle is solvable **iff that digraph is
acyclic**. No search, no dead ends, no need for an undo stack. Any greedy order works.

Difficulty is therefore **not combinatorial**. It is visual search: can the player trace
a 60-cell ray across a dense field and correctly judge whether one thin segment crosses
it. Design for that, not for logic depth.

---

## 2. PoC Goals

In priority order:

1. **Generation is correct and always solvable.** Every generated board has an acyclic
   blocking digraph, near-complete cell coverage, and no unreachable segments.
2. **The game is fun.** Determined by playtesting across the parameter space, using the
   live settings panel.
3. **Performance holds at 100×100 on a phone.** Generation under 1s, 60fps pan/zoom.

**Out of scope for PoC:** levels and progression, scoring, image-import silhouette
pipeline, sound, accounts, monetization.

---

## 3. Requirements

### 3.1 Board & Generation

| Req         | Detail                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- |
| Grid size   | Configurable, 20×20 up to 100×100                                                            |
| Coverage    | As close to 100% as parity allows; 1–3 unvisited cells permitted                             |
| Shapes      | Procedurally generated blobs for PoC. Mask-repair pipeline is built but fed synthetic input. |
| Determinism | Board is a pure function of `(seed, params)`. Same inputs ⇒ identical board, always.         |
| Solvability | Guaranteed by construction or by validation-and-retry. Never ship an unsolvable board.       |

### 3.2 Interaction

| Req           | Detail                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pan & zoom    | Pinch-zoom and drag-pan. Required at 100×100.                                                                                                                                                                   |
| Tap targeting | Hit-test the tapped cell. If it is empty or holds a blocked segment, search outward within a radius for the nearest **free** segment and select that instead. Prevents fat-finger misfires from costing a life. |
| Ray checking  | **No affordance.** The player pans and judges. This is the intended difficulty.                                                                                                                                 |
| Animation     | Fast fixed-duration snake-out. Taps queue during animation and resolve in order.                                                                                                                                |
| Lives         | Fixed count (default 3, configurable). Zero ⇒ restart same seed.                                                                                                                                                |

> **Note on tap-radius snapping:** the radius must only snap to _free_ segments. Snapping
> to a blocked one would cost a life the player didn't intend to risk. If no free segment
> is in radius, treat as a miss with no penalty rather than a bounce.

### 3.3 Rendering

| Req               | Detail                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Piece colors      | Assigned by **greedy graph coloring over the adjacency graph**, 4–6 hues. Adjacent segments must be visually distinguishable or the player cannot tell where one segment ends and the next begins. This is a readability mechanic, not decoration. |
| Legibility        | Arrowheads need ~8–10 CSS px to read as a direction. Below that, zoom is mandatory.                                                                                                                                                                |
| Animation quality | Smooth head-first snake-out. The piece should visibly slither along its own shape.                                                                                                                                                                 |

### 3.4 Dev / Tuning Panel

Live-editable parameters with immediate regenerate:

- `gridSize`, `seed`
- `meanPieceLength`, `pieceLengthVariance`
- `bendProbability`, `minStraightRun`
- `lives`, `animationDuration`

Panel also displays generated-board metrics (§5).

### 3.5 Offline

First-class requirement, not a nice-to-have. The app makes no network calls during play.

| Req                | Detail                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Cold start offline | App loads and is fully playable in airplane mode after one prior visit.                                                |
| Generation offline | All board generation runs on-device. No server round-trip, ever.                                                       |
| No runtime assets  | No fonts, images, or audio fetched at play time. Everything is code or bundled inline.                                 |
| State persistence  | Current board (seed + params + removed-segment list) and lives survive a reload and an app kill.                       |
| Install path       | Installable to home screen. Prompt or instruct, since iOS eviction (§4.1) makes this materially safer for saved state. |

**Acceptance test:** load once, enable airplane mode, force-quit, relaunch — board resumes
mid-game with lives intact, and a fresh board can be generated.

---

## 4. Technical Design

### 4.1 Stack

- **React** owns chrome only: settings panel, lives display, menus.
- **Canvas** owns the board, via an uncontrolled ref React never touches. React
  re-rendering thousands of pieces is the single most likely perf disaster; this rule
  prevents it structurally.
- **No game engine.** No SVG — 10k DOM nodes will fight repaint on iOS Safari for zero benefit.
- **Service worker** caching the bundle. No assets, no network calls, so offline is nearly free.

> **iOS caveat:** if the app is not added to the home screen, Safari evicts IndexedDB
> after ~7 days of non-use. Saved progress vanishes silently. Surface this, or accept it
> for PoC.

### 4.2 Generation Pipeline

```
mask → path fill → cut-and-orient → validation → colors
```

**Step 1 — Mask.** Produce a binary region.

1. Rasterize / generate blob to binary grid.
2. Keep largest connected component.
3. **Morphological open** (erode, then dilate). Load-bearing step: amputates 1-cell-wide
   spurs and severs hairline necks, both of which make a Hamiltonian path impossible.
4. Re-check connectivity, keep largest component again.
5. Fill interior holes below an area threshold.
6. Checkerboard parity check. A Hamiltonian path needs `|black| − |white| ∈ {0, ±1}`.
   **Absorb any mismatch by marking 1–3 cells unvisited** rather than editing the
   silhouette. Visually invisible, kills the feasibility problem entirely.

**Step 2 — Path fill.** Build a Hamiltonian path over the mask.

- **Primary: spanning-tree contour.** Random spanning tree on a half-resolution grid;
  trace the tree's outline at full resolution. The contour walk _is_ a Hamiltonian cycle,
  guaranteed, in linear time. Requires the region to tile into 2×2 blocks.
- **Fallback / randomizer: backbite** (Mansfield). Take an endpoint, pick a random
  neighbor, reverse the tail. Mixes toward near-uniform random paths and handles
  irregular regions the contour method can't tile.

**Step 3 — Cut and orient.** One stage, not two. Cutting the path first and then
searching for an acyclic head assignment does not work at the sizes the game needs:
measured on real contour output, cut placement that is blind to the blocking digraph
produces segmentations with **no** acyclic orientation at all above roughly 20×20, and no
amount of retrying or tuning recovers it (issue #83 has the tables).

So the cut and the head are chosen together, by a peel:

1. Keep the set of not-yet-committed path cells.
2. Propose a piece — a contiguous run of still-free path positions near
   `meanPieceLength`, with `pieceLengthVariance` for spread and `minStraightRun`
   discouraging cuts too close to the end of a straight run — and a head at one of its
   two ends. A piece of two cells or more takes its exit direction from its terminal
   stroke; a one-cell piece has none, so all four are legal for it.
3. Accept only if the ray from that head to the board edge crosses no cell that is still
   free.
4. Commit the piece and remove its cells.

Every blocker on a committed piece's ray is therefore a piece committed earlier, so the
commit order **is** a valid removal order: the blocking digraph is acyclic by
construction, with no search and nothing that can fail to converge.

The peel also cannot stall. The topmost free cell has no free cell above it, so a
one-cell piece there always has a clear northward ray — a legal move exists while any
cell remains. What degrades under pressure is piece quality, not feasibility.

**Step 4 — Validation.** Assert acyclic, assert coverage, assert every segment reachable.
Fail loudly in dev.

**Step 5 — Colors.** Greedy graph coloring over segment adjacency.

### 4.3 Core Data Structures

All typed arrays. **Not** objects — at 100×100 the edge count makes object overhead fatal.

```
occupancy   Uint16Array[cells]      cell index → segment id (0 = empty)
segStart    Uint32Array[n+1]        CSR offsets into segment cell lists
segCells    Uint32Array[totalCells] flattened segment polylines
segHead     Uint32Array[n]          head cell index per segment
segDir      Uint8Array[n]           exit direction, 0–3
edgeStart   Uint32Array[n+1]        CSR offsets into blocking edges
edgeTarget  Uint32Array[edges]      flattened dependency edges
```

CSR from day one, not as a retrofit.

### 4.4 Blocking Digraph

For each segment, walk the ray from its head in `segDir` to the board edge, reading
`occupancy` at each step. Every distinct other segment id encountered is a blocker.
Edge means **blocker must be removed first**.

Cost at 100×100 (~10k cells, est. 700 segments at mean length 14): ~700 rays × ~50 cells
= 35k lookups. Negligible. Even at the pathological end — 50k segments, 450-cell rays —
it is ~25M lookups and under 100ms, with edge _count_ (~5M) as the binding constraint,
which CSR handles at ~40MB.

### 4.5 Rendering

**Two canvas layers.**

- **Static layer:** all idle segments, drawn once to an offscreen canvas at full
  resolution. Redrawn only when a segment leaves.
- **Animation layer:** only the segment currently exiting, redrawn per frame.

**Pan and zoom** are a single `drawImage` from the offscreen buffer to the visible canvas
with source/dest rects. No re-rendering of thousands of segments per frame.

> **Memory cap:** at 3× zoom a 100×100 offscreen buffer is roughly 3000×3000 ≈ 36MB.
> Fine on a modern phone, but cap it and degrade gracefully rather than crashing Safari.

**Snake-out animation:** concatenate the segment's polyline with its exit ray into one
path, then animate `stroke-dashoffset` with dash length equal to the segment length. The
piece appears to slither out head-first for the cost of drawing one polyline per frame.

**Hit testing:** pixel → cell → `occupancy` → segment id. O(1), no geometry.

### 4.6 Architectural Rule

> **The generator is a pure function of `(seed, params)` with zero React coupling.**

It must be callable identically from the dev panel, from a headless test script, and from
the game loop. This is the rule most likely to be violated in week two, and violating it
costs the tuning harness.

---

## 5. Tuning & Metrics

Difficulty is dialed empirically, not by feel. Instrument two numbers, both of which fall
out of the topological sort already being computed:

- **DAG depth** — longest dependency chain. Proxy for how far ahead the board forces you to work.
- **Mean free-set size per step** — how many segments are clickable at any moment. Fewer
  means less to scan, so counterintuitively, _more_ free segments can be harder.

**Headless harness.** Parameters in, metrics out, no rendering. Runs in a fraction of a
second per board. Sweep the parameter space in bulk and find the regions producing the
intended difficulty curve.

### 5.1 Parameter interaction to watch

`bendProbability` trades directly against ray length. A windy segment is compact, so its
head sits nearer the silhouette edge, so its ray is shorter and it frees up early. A
straight segment spans further but exits along a clean corridor. **"More bends = harder"
is not reliably true.** You are tuning a joint distribution — steer by the metrics, not
by intuition.

---

## 6. Build Order

1. Mask pipeline (blob generation + repair + parity)
2. Path fill (spanning-tree contour, then backbite)
3. Segmentation
4. Orientation / acyclicity + validation
5. **Headless stats harness**
6. Renderer (static + animation layers, pan/zoom)
7. Game loop (tap, queue, bounce, lives, win)
8. Dev settings panel

Harness before renderer is deliberate, but for a narrow reason: it is cheap, and it
confirms the parameter space actually _has_ range before you invest in presentation.
It cannot tell you whether the game is fun — **only playing tells you that**, which is why
steps 6 and 7 are core PoC scope, not follow-on work. Expect to iterate between the
harness and live play once both exist.

---

## 7. Known Risks

| #   | Risk                                                                                                                                  | Mitigation                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **`bendProbability` is not natively controllable.** The contour method determines path shape; bendiness isn't a free parameter of it. | Bias spanning-tree growth (weighted Prim favoring straight continuation), or backbite with annealing on a bendiness objective. Resolve early — it's a headline tuning knob. |
| R2  | Orientation search may not converge at high segment counts.                                                                           | Retired: cut-and-orient (§4.2 step 3) constructs an acyclic digraph rather than searching for one, so there is nothing left to converge.                                    |
| R3  | **100×100 may simply not be fun.** Thousands of segments × even a fast animation is a multi-hour board.                               | Metrics harness will expose this before the renderer exists. Be willing to conclude the real ceiling is ~50×50.                                                             |
| R4  | Legibility floor. ~8–10px per arrowhead caps unzoomed boards at ~40 cells across on a phone.                                          | Zoom is mandatory above that, already in scope.                                                                                                                             |
| R5  | Offscreen buffer memory on iOS at high zoom.                                                                                          | Cap buffer size, degrade to re-render on zoom past threshold.                                                                                                               |

---

## 8. Deferred

- Silhouette library (pre-built, human-QA'd masks, RLE-packed). **Use original or
  public-domain / open-licensed shapes only — recognizable third-party character
  silhouettes are protected IP.**
- Image-import pipeline for arbitrary source art
- Levels, progression, persistence
- Ray-trace hint affordance, should playtesting show pan-and-judge is frustrating rather
  than tense
- Scoring, timers, sound
