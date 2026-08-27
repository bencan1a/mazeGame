# Arrow Maze — PRD & Technical Design

**Status:** §1–§8 specify the proof of concept, which is built and shipped — see
[VERDICT.md](./VERDICT.md). §9 specifies the first increment beyond it.
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

| Req           | Detail                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pan & zoom    | Pinch-zoom and drag-pan. Required at 100×100.                                                                                                                                                                                                                                                                                                                    |
| Tap targeting | Hit-test the tapped cell. A cell holding a live segment selects it directly, free or blocked — a blocked one bounces, because the player aimed at it. If the cell is empty, or holds a segment that has already left, search outward within a radius for the nearest **free** segment and select that instead. Prevents fat-finger misfires from costing a life. |
| Ray checking  | **No affordance.** The player pans and judges. This is the intended difficulty.                                                                                                                                                                                                                                                                                  |
| Animation     | Fast fixed-duration snake-out. Taps queue during animation and resolve in order.                                                                                                                                                                                                                                                                                 |
| Lives         | Fixed count (default 3, configurable). Zero ⇒ restart same seed.                                                                                                                                                                                                                                                                                                 |

> **Note on tap-radius snapping:** the radius must only snap to _free_ segments. Snapping
> to a blocked one would cost a life the player didn't intend to risk. If no free segment
> is in radius, treat as a miss with no penalty rather than a bounce.
>
> Aiming directly at a blocked segment is a different act from being snapped onto one, and
> it bounces. An earlier wording sent a blocked direct hit to the radius search too, which
> made `bounced` unreachable: the hit test is the only source of taps and removals only
> unblock, so lives never decremented and §1's lose-and-restart never fired.
>
> The path is space-filling, so a board is nearly fully tiled. At gridSize 100 zoomed to
> fit a phone — roughly 3–4 CSS px per cell — almost every tap lands as a direct hit, so
> the radius rarely engages at the zoom level it was built for. Whether that reads as
> tense or as unfair is for the playtest rounds to settle. If it plays badly, the answer
> is a confidence threshold on the direct hit, not a return to always-redirect.

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

- **Spanning-tree contour, and only it.** Random spanning tree on a half-resolution
  grid; trace the tree's outline at full resolution. The contour walk _is_ a Hamiltonian
  cycle, guaranteed, in linear time. Requires the region to tile into 2×2 blocks.
- A region it can't tile fails the generation attempt, which retries on a fresh internal
  seed. A backbite fallback was built for that case and removed unused: on procedurally
  generated blobs the contour method has never declined (issue #109 has the measurement).

**Step 3 — Cut and orient.** One stage, not two. Cutting the path first and then
searching for an acyclic head assignment does not work at the sizes the game needs:
measured on real contour output, cut placement that is blind to the blocking digraph
produces segmentations with **no** acyclic orientation at all above roughly 20×20, and no
amount of retrying or tuning recovers it (issue #83 has the tables).

So the cut and the head are chosen together, by a peel:

1. Keep the set of not-yet-committed path cells.
2. Propose a piece — a contiguous run of still-free path positions near
   `meanPieceLength`, with `pieceLengthVariance` for spread, `minPieceLength` as a hard
   floor, and `minStraightRun` discouraging cuts too close to the end of a straight
   run — and a head at one of its two ends. A piece takes its exit direction from its
   terminal stroke, so choosing the head fixes it; only a one-cell piece, which
   `minPieceLength` rules out by default, is free to point anywhere.
3. Accept only if the ray from that head to the board edge crosses no cell that is still
   free.
4. Commit the piece and remove its cells.

Every blocker on a committed piece's ray is therefore a piece committed earlier, so the
commit order **is** a valid removal order: the blocking digraph is acyclic by
construction, with no search and nothing that can fail to converge.

The peel also cannot stall. Take the topmost free cell and, within that row, the
leftmost: nothing free is above it or west of it, so both those rays are clear, and
every free path-neighbour it has is east of it or below it — so a piece ending there
exits north or west either way. A legal move exists while any cell remains. What
degrades under pressure is piece quality, not feasibility, and
[CONTRACTS.md](./CONTRACTS.md) has the measured numbers for how much.

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
2. Path fill (spanning-tree contour)
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

| #   | Risk                                                                                                                                         | Mitigation                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **`bendProbability` was not natively controllable.** The contour method determines path shape, and bendiness was not a free parameter of it. | Retired: biasing spanning-tree growth makes achieved bend rate track the request monotonically. It is a bounded band rather than a target rate — the ceiling is ~0.48 at any size, and the floor rises as the board shrinks (~0.06 at gridSize 100, ~0.26 at 20) because a small region's boundary forces corners. |
| R2  | Orientation search may not converge at high segment counts.                                                                                  | Retired: cut-and-orient (§4.2 step 3) constructs an acyclic digraph rather than searching for one, so there is nothing left to converge.                                                                                                                                                                           |
| R3  | **100×100 may simply not be fun.** Thousands of segments × even a fast animation is a multi-hour board.                                      | Metrics harness will expose this before the renderer exists. Be willing to conclude the real ceiling is ~50×50.                                                                                                                                                                                                    |
| R4  | Legibility floor. ~8–10px per arrowhead caps unzoomed boards at ~40 cells across on a phone.                                                 | Zoom is mandatory above that, already in scope.                                                                                                                                                                                                                                                                    |
| R5  | Offscreen buffer memory on iOS at high zoom.                                                                                                 | Retired on iOS: the constraint is a per-canvas cap between 8192² and 10000², not a total, and two 8192² layers coexist. Cap each layer; no re-render-on-zoom needed. Not measured on Android.                                                                                                                      |

---

## 8. Deferred

- Image-import pipeline for arbitrary source art
- Levels, progression, and anything that scores or ranks a board
- Ray-trace hint affordance, should playtesting show pan-and-judge is frustrating rather
  than tense
- Scoring, timers, sound

The silhouette library moved out of this list and into §9. Persistence shipped in the
PoC.

---

## 9. Shape Library & Home Screen

The PoC plays one procedurally generated blob. This increment makes the board a
**picture of something the player chose**, which is the first thing that makes this a
product rather than a demo.

The mechanism is settled and measured: a line drawing's strokes are empty space, and the
enclosed faces between them become the lobes the player fills. Evidence, including what
does not work, is in [`docs/spikes/line-art/`](./spikes/line-art/README.md).

### 9.1 The library

| Req         | Detail                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | Phosphor Icons, `thin` weight, MIT. Its art is a drawn fill rather than a stroke, so it needs no stroke handling.                                                                      |
| Curation    | Filtered by the set's own categories to exclude brand marks, letterforms, interface glyphs and chart furniture, then approved by eye.                                                  |
| Size        | 100 or more shapes at launch, drawn from the ~400 that survive the category filter.                                                                                                    |
| Baking      | Rasterised at build time to a 96×96 packed bitmap per shape, shipped beside each drawing's own path geometry. No rasteriser ships, and generation stays a pure function of its inputs. |
| Delivery    | One precached asset plus a manifest, not part of the JS bundle. Offline still means offline: the asset is cached on first load.                                                        |
| Attribution | Phosphor's MIT notice ships with the build as a third-party notices file, not as UI. See below.                                                                                        |

**No shape is a brand, a letter, a number or a symbol.** PRD §8's constraint on
third-party IP holds: original or open-licensed drawings only.

**On the notice.** MIT asks that the copyright and permission notice travel with copies
of the work, and a public deployment is a copy — that obligation does not turn on whether
anyone is charged for it. It says nothing about where the notice lives, so it ships as
`THIRD-PARTY-NOTICES.md` in the repo and as a file the build emits at a stable path
beside the shape asset. Nothing about it appears in the game's chrome.

### 9.2 Board from a shape

| Req          | Detail                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Determinism  | A board is a pure function of `(shape, seed, params)`. The same three always give the same board.                                  |
| Default seed | Derived from the shape's id, so a given shape opens on the same board every time and a lost board stays a puzzle you can learn.    |
| Grid size    | The shipped default of 78 stands. Shape boards run roughly 40% shorter than procedural ones at the same size, which is acceptable. |
| Failure      | A shape that cannot generate is not shown. Curation catches this at build time, not at play time.                                  |
| Procedural   | Still reachable: with no shape chosen, the generator draws a blob exactly as it does today.                                        |

### 9.3 Home screen

The app opens here.

| Req         | Detail                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Preview     | Shows **the drawing**, not the board — the line art as it will be tiled, plus the shape's name. |
| Cycling     | Previous and next controls step through the library and wrap at both ends.                      |
| Play        | One primary control starts the board for the shape on screen.                                   |
| Resume      | If a board is in progress, its shape is marked, and Play reads as Resume on that shape.         |
| Persistence | The shape on screen survives a reload, so the app reopens where the player left it.             |
| Offline     | Everything above works with no network, on first load after install.                            |

### 9.4 Navigation and the board in progress

| Req            | Detail                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Back to home   | A control in the game chrome returns to the home screen at any time.                                                       |
| Save slot      | **One.** Leaving a board keeps it; starting a different shape replaces it.                                                 |
| Warning        | The home screen marks the shape holding the save, so a player can see what starting a different one costs before doing it. |
| Deep link      | `?shape=<id>` opens the game directly on that shape, for testing and for sharing a board.                                  |
| Existing panel | The tuning panel stays exactly as it is, on the game screen.                                                               |

### 9.5 Out of scope for this increment

Levels, progression, scoring, favourites, search, category browsing, per-shape saves,
non-square boards, and generated cuts inside oversized faces. Each is a real idea with
evidence behind it; none of them is needed to let a player pick a cat and play it.
