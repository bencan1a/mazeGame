# Backlog

<!-- Generated from scripts/backlog.json by scripts/seed-github.mjs --render. Edit the JSON, not this file. -->

Readable index of the work. **GitHub Issues are the source of truth**
(ADR-0005) — this file is the seed and a map, not a status board. Issues
are seeded; go to the issue for current status, assignee, and discussion.

Seed or reconcile:

```sh
node scripts/seed-github.mjs --dry-run   # preview
node scripts/seed-github.mjs             # create what is missing
```

32 issues, 6 milestones, 27 labels.

## Milestones

| Milestone | Meaning |
|---|---|
| M0 — Repo ready | Scaffolding, contracts, CI, task board, agent workflow. |
| M1 — A board exists | generateBoard returns a validated, acyclic, deterministic board headlessly. |
| M2 — Range confirmed | Metrics harness sweeps the parameter space; difficulty range and generation time confirmed. |
| M3 — Playable | Board renders, taps work, lives count, a board can be won on a phone — at 60fps. |
| M4 — Tunable & offline | Dev panel regenerates live; airplane-mode acceptance test passes on device. |
| M5 — Verdict | Playtest rounds complete, defaults chosen, PoC recommendation written. |

## Wave 0

### Test fixture builders: makeMask, makePath, makeBoard

`stream:harness` · M1 — A board exists · `contract-change` `M1`

Fixtures are how the streams run in parallel: every stage is developed against a synthetic version of its own input rather than waiting for the stage upstream of it. This is the first task after contracts and it unblocks everyone.

**Acceptance criteria**

- [ ] `makeMask(spec)` builds a Mask from an ASCII-art string (`#` inside, `.` outside, `o` unvisited) and from a plain rectangle
- [ ] `makePath(mask)` returns a trivially-correct boustrophedon Hamiltonian path over a rectangular mask
- [ ] `makeBoard(spec)` returns a small hand-checkable Board with correct CSR arrays
- [ ] A deliberately cyclic board fixture exists, so validation can be tested for the failing case
- [ ] Fixtures satisfy the postconditions in docs/CONTRACTS.md — asserted by their own tests
- [ ] ASCII specs round-trip: `render(makeMask(s)) === s`

### Procedural blob generator

`stream:mask` · M1 — A board exists · `M1`

Produce a binary silhouette to feed the repair pipeline. Crude is fine to start — S2 needs some mask to path-fill. PRD §3.1 says procedural blobs for the PoC; the mask-repair pipeline is built but fed synthetic input.

**Acceptance criteria**

- [ ] Deterministic given (seed, gridSize) — same inputs, identical grid
- [ ] Produces an organically-shaped region, not a rectangle or a disc
- [ ] Region area is a tunable fraction of the grid
- [ ] No use of Math.random or Date.now (lint enforces this)
- [ ] Property test: output is always non-empty and fits inside the grid

## Wave 1

### Mask repair: largest component, morphological open, hole fill

`stream:mask` · M1 — A board exists · `M1`

PRD §4.2 step 1. The morphological open (erode then dilate) is the load-bearing step: it amputates 1-cell-wide spurs and severs hairline necks, both of which make a Hamiltonian path impossible. Connectivity must be re-checked afterwards because opening can disconnect the region.

**Acceptance criteria**

- [ ] Largest 4-connected component extraction, with a test on a mask with three islands
- [ ] Erode then dilate with a documented structuring element
- [ ] Connectivity re-checked and largest component re-taken after the open
- [ ] Interior holes below an area threshold are filled
- [ ] Property test: no cell in the repaired mask has fewer than 2 inside-neighbours
- [ ] Property test: result is exactly one 4-connected component

### Checkerboard parity absorption

`stream:mask` · M1 — A board exists · `M1`

A Hamiltonian path needs |black| - |white| in {0, +/-1}. PRD §4.2 step 1.6 is explicit that the mismatch is absorbed by marking 1-3 cells unvisited rather than by editing the silhouette — visually invisible, and it removes the feasibility problem entirely.

**Acceptance criteria**

- [ ] Counts checkerboard classes over inside cells
- [ ] Marks the minimum number of cells unvisited to bring the imbalance into {0, +/-1}
- [ ] Unvisited cells are chosen so the remaining region stays 4-connected
- [ ] `pathCellCount` matches the count of inside && !unvisited cells
- [ ] Property test over 500 random blobs: parity condition holds and connectivity survives
- [ ] If more than 3 cells would be needed, fail loudly rather than silently degrading

### Path fill: spanning-tree contour

`stream:path` · M1 — A board exists · `M1`

PRD §4.2 step 2, primary method. A random spanning tree on a half-resolution grid, with the tree's outline traced at full resolution. The contour walk IS a Hamiltonian cycle, guaranteed, in linear time. Requires the region to tile into 2x2 blocks — detect and report when it does not, so the backbite fallback can take over.

**Acceptance criteria**

- [ ] Returns a HamiltonianPath satisfying every postcondition in docs/CONTRACTS.md
- [ ] Reports cleanly (not by throwing on a happy path) when the region will not tile into 2x2 blocks
- [ ] Linear time — a 100x100 region completes in well under 100ms
- [ ] Deterministic for a given (mask, seed)
- [ ] Property test over fixture masks: every path cell visited exactly once, consecutive cells are 4-neighbours

### Path fill: backbite fallback and randomizer

`stream:path` · M1 — A board exists · `M1`

PRD §4.2 step 2, fallback. Mansfield's backbite: take an endpoint, pick a random neighbour, reverse the tail. Mixes toward near-uniform random paths and handles irregular regions the contour method cannot tile.

**Acceptance criteria**

- [ ] Handles regions the contour method rejects
- [ ] Path invariants hold after every move, not just at the end (assert in dev)
- [ ] Mixing iteration count is a parameter with a documented default
- [ ] Terminates within a time box; reports failure rather than spinning
- [ ] Property test: the path remains Hamiltonian across thousands of backbite moves

### Segmentation: cut the path into pieces

`stream:topology` · M1 — A board exists · `M1`

PRD §4.2 step 3. Cut per meanPieceLength and pieceLengthVariance, with minStraightRun constraining where cuts may land.

**Acceptance criteria**

- [ ] Segments partition the path exactly — concatenation reproduces the original cell order
- [ ] Mean segment length is within tolerance of meanPieceLength over 100 boards
- [ ] No cut leaves a straight run shorter than minStraightRun, except where the path offers none
- [ ] No empty segments; CSR arrays are well-formed
- [ ] Deterministic for a given (path, params, seed)

### Blocking digraph construction (CSR)

`stream:topology` · M1 — A board exists · `M1`

PRD §4.4. Walk the ray from each head in segDir to the board edge, reading occupancy. Every distinct OTHER segment id on the ray is a blocker; the edge means the blocker must be removed first. A segment's own body never blocks it.

**Acceptance criteria**

- [ ] Self-blocking is impossible — a segment crossing its own ray produces no self-edge
- [ ] Duplicate blockers de-duplicated: a long segment crossing a ray twice yields one edge
- [ ] CSR output, edgeStart length n+1, edges sorted within each row
- [ ] Hand-checked fixture board produces exactly the expected edge set
- [ ] 100x100 construction time measured and recorded in the issue

### Orientation: acyclic head assignment via SCC local search

`stream:topology` · M1 — A board exists · `risk:R2` `M1`

PRD §4.2 step 4. Each segment has exactly two legal heads. Choose an assignment making the blocking digraph acyclic. This is NOT 2-SAT — acyclicity is not a binary clause — so: build graph, Tarjan SCC, flip a segment inside a non-trivial SCC, recheck, repeat. Time-box it; R2 says fall back to reverse construction.

**Acceptance criteria**

- [ ] Tarjan SCC implementation with its own tests, including nested and trivial SCC cases
- [ ] Local search flips heads inside non-trivial SCCs and re-checks
- [ ] Hard time box; on expiry it reports failure rather than spinning
- [ ] Automatic fallback to reverse construction, and the fallback is recorded in metrics
- [ ] Property test over 500 boards: the resulting digraph is always acyclic

### Orientation fallback: reverse construction

`stream:topology` · M1 — A board exists · `risk:R2` `M1`

PRD §4.2 step 4 escape hatch, and R2's mitigation. Start with an empty board and slide segments in from the edge one at a time; the reversed insertion order is a guaranteed-valid removal order, so acyclicity is free by construction. Build it in Wave 1 rather than deferring — discovering you need it in Wave 3 is expensive.

**Acceptance criteria**

- [ ] Produces a board whose blocking digraph is acyclic by construction, with no search
- [ ] Packing density measured against the local-search path and recorded — this is the trade
- [ ] Used automatically when local search times out
- [ ] Property test over 200 boards at 40x40 and 100x100: always acyclic, always fully covered

### Segment coloring: greedy over the adjacency graph

`stream:topology` · M1 — A board exists · `M1`

PRD §3.3 and §4.2 step 6. Adjacent segments must be visually distinguishable or the player cannot tell where one segment ends and the next begins. This is a readability mechanic, not decoration — so the test asserts the property, not merely that colors were assigned.

**Acceptance criteria**

- [ ] Adjacency graph built from 4-neighbour cell contacts between different segments
- [ ] Greedy coloring using 4-6 hues
- [ ] Property test over 500 boards: no two adjacent segments share a palette index
- [ ] If 6 hues are insufficient for some board, that is reported rather than silently reused
- [ ] Palette itself lives in the render layer, not in core — core emits indices only

### Board validation: acyclicity, coverage, reachability, determinism

`stream:harness` · M1 — A board exists · `M1`

PRD §4.2 step 5 — assert and fail loudly in dev. This is the gate on PoC goal 1: never ship an unsolvable board.

**Acceptance criteria**

- [ ] Topological sort consumes all n segments, else BoardInvariantError
- [ ] Coverage >= 99% of inside cells, with unvisited cells accounting for the remainder
- [ ] occupancy and the CSR segment lists agree in both directions
- [ ] A simulated greedy clear removes every segment
- [ ] Determinism check: regenerating from the same (seed, params) yields byte-identical arrays
- [ ] Each failure names the offending segment or cell — a bare 'invalid board' is not enough

### generateBoard(params): wire the pipeline end to end

`stream:harness` · M1 — A board exists · `contract-change` `M1`

The single public entry point, pure in (seed, params) per ADR-0004. Callable identically from the dev panel, a headless script, and the game loop.

**Acceptance criteria**

- [ ] generateBoard(params) runs mask -> path -> segmentation -> orientation -> validation -> colors
- [ ] Validation runs in dev and in tests; production behaviour on failure is documented
- [ ] Retry-with-new-internal-seed on validation failure, bounded and counted
- [ ] No React, DOM, clock, or Math.random anywhere in the call tree (lint enforces)
- [ ] Integration test: 1000 seeds at 20x20, 40x40, and 100x100 all validate

### SPIKE: canvas blit and buffer-memory floor at 100x100

`stream:render` · M2 — Range confirmed · `spike` `risk:R3` `risk:R5` `device` `M2`

The whole renderer design rests on one assumption: a large offscreen buffer can be blitted per frame with drawImage fast enough for 60fps pan/zoom, and iOS Safari will tolerate its memory. That assumption is testable TODAY with a bare benchmark page — no generator, no renderer, no React — so test it before five other tasks are built on top of it. R3 is a performance risk rather than a playability one (ADR-0006), and this is the cheap half of the answer.

**Acceptance criteria**

- [ ] Standalone benchmark page: allocate a ~3000x3000 offscreen canvas, draw a few hundred synthetic polylines into it
- [ ] Blit it per frame under simulated pan and zoom; report frame rate
- [ ] Run on a real iOS device and a real Android device; record model, OS version, and numbers in the issue
- [ ] Peak memory recorded; the point at which Safari degrades or drops the buffer found by increasing size until it does
- [ ] A written verdict: does the two-layer + drawImage architecture hold at 100x100, and what is the safe buffer cap
- [ ] If it does not hold, propose the alternative (tiled buffers, lower-resolution static layer, re-render on zoom) before the renderer is built
- [ ] This cannot be run in CI — a frame rate from a headless Linux runner says nothing about a phone (docs/TESTING.md)

## Wave 2

### SPIKE: make bendProbability actually controllable

`stream:path` · M2 — Range confirmed · `spike` `risk:R1` `M2`

R1, and the PRD calls it a headline tuning knob. The contour method determines path shape; bendiness is not a free parameter of it. Candidate approaches: bias spanning-tree growth (weighted Prim favouring straight continuation), or backbite with annealing on a bendiness objective. Resolve early — the answer changes what the dev panel can honestly offer.

**Acceptance criteria**

- [ ] Measured bendRate plotted against requested bendProbability across at least 5 settings and 50 seeds each
- [ ] A written answer in the issue: does the achieved rate track the requested one, and over what range
- [ ] If it does not track, either a working alternative or an explicit recommendation to drop/rename the parameter
- [ ] Time-boxed; a negative result written up is a successful outcome

### Board metrics: DAG depth, free-set size, bend rate, coverage

`stream:harness` · M2 — Range confirmed · `M2`

PRD §5. Both headline numbers fall out of the topological sort validation already computes — compute them there rather than walking the graph twice. See docs/METRICS.md.

**Acceptance criteria**

- [ ] All BoardMetrics fields populated per docs/CONTRACTS.md
- [ ] dagDepth and free-set statistics computed in a single pass with the topological sort
- [ ] Hand-checked fixture board yields exactly the expected metrics
- [ ] generationMs measured by the caller, not inside core (ADR-0004)
- [ ] Metrics on a 100x100 board add under 10ms

### Headless sweep harness CLI

`stream:harness` · M2 — Range confirmed · `M2`

PRD §5 and §6 step 5. Parameters in, metrics out, no rendering. Harness before renderer is deliberate: it is cheap, and it confirms the parameter space actually has range before anyone invests in presentation.

**Acceptance criteria**

- [ ] `npm run harness -- --seeds N --grid G` prints aggregate metrics
- [ ] `--sweep <file.json>` runs a parameter grid and writes JSON or CSV
- [ ] Runs in plain Node with no DOM
- [ ] A 200-board sweep at 40x40 completes in seconds
- [ ] Failures are reported per-board with the seed, so any failure is reproducible

### Sweep report: does the parameter space have usable range?

`stream:harness` · M2 — Range confirmed · `M2`

The gate on M2. Two questions: does varying the parameters actually move dagDepth and free-set size, and does generation stay under 1s at 100x100. Note what this does NOT settle: R3 is a performance risk, not a playability one (ADR-0006) — grid size is a parameter the player turns down — and frame rate and buffer memory need a device, not a headless sweep. A clean sweep at 100x100 means the board can be BUILT in time, nothing more.

**Acceptance criteria**

- [ ] Sweep across gridSize, meanPieceLength, pieceLengthVariance, bendProbability
- [ ] Written report in docs/sweeps/ with the data and the plots or tables
- [ ] Explicit answer: which parameter regions produce which difficulty profile
- [ ] Explicit answer: does generationMs stay under 1s at 100x100
- [ ] segmentCount x animation duration reported as a clear-time estimate per grid size — a fact, not a verdict
- [ ] Recommended default parameters for first playtest
- [ ] No claim made about frame rate, memory, or fun — those are not measurable here

### CI generation-time regression check

`stream:harness` · M2 — Range confirmed · `M2`

Run the headless harness in CI and fail on a large generation-time regression. GitHub runners are shared and noisy, so this is a relative check with a wide threshold — it catches 'this PR made generation 4x slower' and says nothing about the absolute 1s target, which is read off a device (docs/TESTING.md D3).

**Acceptance criteria**

- [ ] CI job runs a fixed seed set at 40x40 and 100x100 and records generationMs
- [ ] Threshold wide enough not to flake on runner variance — start at 2x a committed baseline
- [ ] Baseline committed and updated deliberately, with the commit that changed it named
- [ ] Failure output names the seeds and sizes that regressed
- [ ] Job is a warn/soft gate, and the CI summary says explicitly that it is not the G3 measurement

## Wave 3

### Two-layer canvas renderer: static offscreen layer

`stream:render` · M3 — Playable · `M3`

PRD §4.5. All idle segments drawn once to an offscreen canvas at full resolution, redrawn only when a segment leaves. React never touches this canvas (ADR-0002).

**Acceptance criteria**

- [ ] Renders a fixture board without any generator dependency
- [ ] Offscreen buffer, redrawn only on segment removal
- [ ] Uncontrolled ref; no React state per segment
- [ ] Buffer size capped, with documented degradation past the cap (R5)
- [ ] Draws correctly at 20x20 through 100x100

### Automated browser tests: offline, persistence, hit testing, game loop

`stream:infra` · M3 — Playable · `M3`

Headless Chromium via Playwright on a Linux runner, covering the behaviour that IS automatable: service worker registration and a genuinely offline second load, manifest/scope/start_url under the deployed base path, persistence across reload, synthetic taps resolving to the expected segment, and the game loop's bounce/lives/win transitions. See docs/TESTING.md for what this deliberately does not cover — a frame rate from a Linux runner is not evidence about a phone, and no CI gate should imply it is.

**Acceptance criteria**

- [ ] Playwright installed as a dev dependency and wired into CI
- [ ] Offline test: load once, context.setOffline(true), reload, app still works
- [ ] PWA test: manifest, icons, scope, and start_url all resolve under the deployed base path
- [ ] Persistence test: (seed, params, removed, lives) survives a reload
- [ ] Hit-test: a synthetic tap at a known pixel selects the expected segment on a fixture board
- [ ] Game loop: bounce costs a life, zero lives restarts the same seed, clearing every segment wins
- [ ] Visual regression on a fixture board, with a tolerance loose enough not to flake on runner antialiasing
- [ ] No frame-rate assertion — that measurement is not meaningful here

### Arrowheads and legibility floor

`stream:render` · M3 — Playable · `risk:R4` `device` `M3`

PRD §3.3 and R4. Arrowheads need roughly 8-10 CSS px to read as a direction, which caps unzoomed boards at about 40 cells across on a phone. Measure it on a device rather than estimating.

**Acceptance criteria**

- [ ] Arrowhead drawn at the head, pointing along the terminal stroke
- [ ] Segment polylines drawn with rounded joins so a piece reads as one object
- [ ] Measured minimum legible size on a real phone, recorded in the issue
- [ ] Below the legible threshold, zoom is required — the UI says so rather than rendering mush
- [ ] Colors come from a palette indexed by segColor; adjacent pieces are visibly distinct

### Pan and zoom

`stream:render` · M3 — Playable · `risk:R5` `device` `M3`

PRD §3.2 — required at 100x100. Implemented as a single drawImage from the offscreen buffer with source and destination rects. Thousands of segments are never re-rendered per frame.

**Acceptance criteria**

- [ ] Pinch-zoom and drag-pan on touch, plus mouse/trackpad for desktop dev
- [ ] Single drawImage per frame; no per-segment work while panning
- [ ] 60fps on a real phone at 100x100 — measured, not assumed
- [ ] Zoom clamped to the buffer memory cap, degrading to re-render past it (R5)
- [ ] Pan bounded so the board cannot be lost off-screen

### Snake-out exit animation

`stream:render` · M3 — Playable · `M3`

PRD §3.3 and §4.5. Concatenate the segment's polyline with its exit ray into one path and animate the dash offset with dash length equal to the segment length. The piece visibly slithers out head-first for the cost of one polyline per frame.

**Acceptance criteria**

- [ ] The piece follows its own polyline, then the ray, then leaves the board
- [ ] Fixed duration from PlayParams.animationDurationMs
- [ ] Only the animating segment is redrawn per frame; static layer untouched until it finishes
- [ ] Reads as slithering, not as sliding or fading — judged on device
- [ ] Animation completes reliably even if the tab is backgrounded mid-flight

### Hit testing and free-segment tap radius

`stream:app` · M3 — Playable · `M3`

PRD §3.2 plus its explicit note. Hit test is pixel -> cell -> occupancy -> segment id, O(1). The radius search MUST only snap to free segments: snapping to a blocked one would cost a life the player never chose to risk. No free segment in radius is a no-op miss, not a bounce.

**Acceptance criteria**

- [ ] Direct hit on a free segment selects it
- [ ] Empty cell or blocked segment searches outward within a radius for the nearest FREE segment
- [ ] No free segment in radius is a miss with no life lost — asserted by test
- [ ] The radius never snaps to a blocked segment under any input — asserted by test
- [ ] Radius is in CSS pixels and holds its physical size across zoom levels

### Game loop: tap queue, bounce, lives, win, restart

`stream:app` · M3 — Playable · `M3`

PRD §3.2. Taps queue during animation and resolve in order. A blocked tap bounces and costs a life. Zero lives restarts the SAME seed — a failed board stays a puzzle you can learn, not a reroll.

**Acceptance criteria**

- [ ] Tapping a free segment removes it; tapping a blocked one bounces and costs a life
- [ ] Taps queue during animation and resolve in order
- [ ] Clearing every segment wins
- [ ] Zero lives restarts the same seed with the same board
- [ ] Removal state lives in the game layer as a removed-set; Board is never mutated
- [ ] State machine is unit-tested headlessly against a fixture board, with no canvas

### Device performance pass at 100x100 (G3 gate)

`stream:render` · M3 — Playable · `risk:R3` `risk:R5` `device` `M3`

PoC goal 3, and the gate on M3: generation under 1s, 60fps pan/zoom, and buffer memory inside a cap iOS Safari tolerates. This sits at the end of Wave 3 rather than in Wave 4 because it is the one PoC goal whose failure can force an architecture change rather than a parameter change — late is expensive. Grid size being adjustable does NOT make this soft: it is a stated goal, and retreating to a smaller maximum is a recorded decision, not a default.

**Acceptance criteria**

- [ ] Generation time at 100x100 measured on a real phone, recorded in the issue
- [ ] Pan/zoom frame rate measured on a real phone at 100x100
- [ ] Peak memory measured; buffer cap validated by forcing it
- [ ] Degradation past the cap verified to be graceful, not a crash
- [ ] Measured against the canvas-perf-spike predictions — if they disagree, say why
- [ ] If a target is missed: a written architecture recommendation, and an explicit recorded decision if the maximum grid size drops
- [ ] Device model and OS version recorded alongside every number; results from different hardware are not combined

## Wave 4

### Dev tuning panel

`stream:app` · M4 — Tunable & offline · `M4`

PRD §3.4. Live-editable parameters with immediate regenerate, plus a metrics readout. This is the instrument the whole tuning phase runs on, so it calls the same generateBoard the game does (ADR-0004).

**Acceptance criteria**

- [ ] Live edit of gridSize, seed, meanPieceLength, pieceLengthVariance, bendProbability, minStraightRun, lives, animationDuration
- [ ] Immediate regenerate on change
- [ ] Displays the §5 metrics for the current board
- [ ] Calls the same generateBoard as the game — no parallel code path
- [ ] Collapsible, and out of the way during play on a phone screen

### State persistence: seed, params, removed segments, lives

`stream:app` · M4 — Tunable & offline · `M4`

PRD §3.5. Current board and lives must survive a reload and an app kill. Because a board is a pure function of (seed, params), persistence is those two plus the removed-segment list — not a serialized board.

**Acceptance criteria**

- [ ] Persists (seed, params, removedSegments, lives) and restores mid-game
- [ ] Survives reload and force-quit
- [ ] Storage failures degrade to a fresh board rather than a crash
- [ ] Restored board is verified identical to the persisted one via the seed
- [ ] iOS eviction caveat surfaced to the player, or explicitly accepted in the issue

### Offline: service worker, install path, airplane-mode acceptance test

`stream:app` · M4 — Tunable & offline · `device` `M4`

PRD §3.5 — first-class requirement, not a nice-to-have. No network calls during play, ever. No runtime fonts, images, or audio. iOS evicts IndexedDB after ~7 days for non-installed sites, which is why the install path matters for saved state.

**Acceptance criteria**

- [ ] App loads and is fully playable in airplane mode after one prior visit
- [ ] No network requests at all during play — verified on a devtools trace
- [ ] Installable to home screen, with a prompt or instructions
- [ ] ACCEPTANCE TEST run on a real device: load once, airplane mode, force-quit, relaunch — board resumes mid-game with lives intact, and a fresh board can be generated
- [ ] Result of that test recorded in the issue
- [ ] Run against the deployed HTTPS build, not the LAN dev server — http://192.168.x.x is not a secure context, so service workers never register there

### Playtest rounds across the parameter space

`stream:app` · M5 — Verdict · `device` `M5`

PoC goal 2, and the only one that cannot be automated. The harness cannot tell you whether the game is fun; only playing does. Structured sessions across the regions the sweep identified.

**Acceptance criteria**

- [ ] At least 3 sessions across distinct parameter regions
- [ ] Each session logged in docs/playtest/ with parameters, board seed, time to clear, lives lost, and notes
- [ ] Explicit note on whether pan-and-judge is tense or merely frustrating (PRD §8)
- [ ] Explicit note on whether the tap radius ever caused an unintended bounce
- [ ] Boards that were unpleasant are recorded with their seed so they can be re-examined

### PoC verdict and recommended defaults

`stream:app` · M5 — Verdict · `M5`

Closes the PoC. Answers the three questions in PRD §2 with evidence, and says what a v1 would need.

**Acceptance criteria**

- [ ] docs/VERDICT.md written
- [ ] Answers goal 1 (correctness) with sweep numbers
- [ ] Answers goal 2 (fun) with playtest evidence, including the negative findings
- [ ] Answers goal 3 (performance) with device measurements, and states the grid sizes that hold 60fps
- [ ] Recommended default parameters
- [ ] Says which deferred items (PRD §8) playtesting promoted — notably the ray-trace hint
