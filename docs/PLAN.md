# Arrow Maze PoC — Development Plan

Derived from [PRD.md](./PRD.md). This is the working plan for a single human
plus several Claude agents building in parallel.

The PRD's §6 Build Order is a dependency order, not a schedule. This plan turns
it into **work streams that can run concurrently**, which requires one extra
idea the PRD does not have: every stage is developed against **synthetic
fixtures** for its own input, so no stream waits on the stream upstream of it.

---

## 1. What "done" means for the PoC

The PoC answers three questions, in priority order (PRD §2):

| #   | Question                                   | Evidence that settles it                                                                              |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| G1  | Is generation correct and always solvable? | 10,000-board headless sweep, zero validation failures, zero cycles, coverage ≥ 99%                    |
| G2  | Is the game fun?                           | Playtest log across the parameter space, with a written verdict per region                            |
| G3  | Does it hold at 100×100 on a phone?        | Generation < 1s, 60fps pan/zoom, and buffer memory inside the cap, all measured on real hardware (R3) |

G1 is objective and gated by CI. G3 is objective and gated by a benchmark **on
a device** — the headless harness can measure generation time, but nothing about
frame rate or buffer memory, which is where G3 actually fails. Which checks are
automatable and which need a phone is spelled out in
[TESTING.md](./TESTING.md); the short version is that CI guards against
regressions and cannot settle G3 at all.
**G2 is the only one that can fail quietly**, so the plan front-loads getting to
a playable board and treats "playtest and write down what happened" as real,
scheduled work rather than a thing that happens at the end.

### Non-goals

Everything in PRD §8, plus: no scoring, no levels, no accounts, no sound, no
silhouette library, no image import. An agent that finds itself building any of
these has drifted — stop and open an issue instead.

### Deviation from the PRD: R3 is a performance risk, not a playability one

PRD §7 states R3 as "100×100 may simply not be fun — thousands of segments ×
even a fast animation is a multi-hour board", and mitigates it by having the
metrics harness expose the problem before the renderer exists.

**This plan does not treat that as a risk.** Grid size is a parameter, exposed
in the dev panel and adjustable per board. A 100×100 board being a long sitting
is a property of that setting, not a defect — the player picks a smaller board,
exactly as they would pick a smaller sudoku. There is no decision to make and
therefore nothing to de-risk.

What is genuinely at risk at 100×100 is **performance**: generation under 1s,
60fps pan and zoom, and an offscreen buffer that does not exhaust Safari. That
is G3, and it is unforgiving in a way playability is not — missing it can force
an architecture change rather than a parameter change.

Two consequences run through the rest of this plan:

- The headless harness settles only the **generation-time** part of G3. Frame
  rate and memory need a canvas on a real device, so "harness before renderer"
  no longer covers R3 the way the PRD assumed it would.
- The device performance work therefore moves **earlier** — a bare canvas
  benchmark in Wave 3's first slot (runnable during Wave 1, since it needs
  neither generator nor renderer), and the full device pass at the end of
  Wave 3 rather than in Wave 4.

Recorded as [ADR-0006](./adr/0006-grid-size-is-a-parameter.md). The PRD is left
as written; this plan is where the departure lives.

---

## 2. Phases and milestones

Phases overlap. The milestone is the gate, not the phase boundary.

| Milestone                  | Meaning                                                                              | Gates                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **M0 — Repo ready**        | Scaffolding, contracts, CI, task board, agent workflow                               | ✅ this commit                                                     |
| **M1 — A board exists**    | `generateBoard(params)` returns a validated, acyclic, deterministic board headlessly | Validation suite green at 20×20…100×100, 1000 seeds                |
| **M2 — Range confirmed**   | Metrics harness sweeps the parameter space and reports DAG depth / free-set size     | A written sweep report + generation time at 100×100                |
| **M3 — Playable**          | Board renders, taps work, lives count, a board can be won on a phone                 | Hands-on play, plus the G3 performance pass, both on real hardware |
| **M4 — Tunable & offline** | Dev panel regenerates live; airplane-mode acceptance test passes                     | PRD §3.5 acceptance test, on device                                |
| **M5 — Verdict**           | Playtest rounds complete; parameter defaults chosen; PoC recommendation written      | `docs/playtest/` log + `docs/VERDICT.md`                           |

**M1 and M2 are the critical path.** M3 work (renderer, input) is independent of
them and should run in parallel from day one against fixture boards, precisely
so that M3 is not sitting idle waiting on M1.

---

## 3. Work streams

A stream is a lane one agent can own without colliding with another agent.
Ownership is by directory (see [WORKFLOW.md](./WORKFLOW.md) §File ownership).

| Stream                        | Owns                                                        | Depends on                 | Can start   |
| ----------------------------- | ----------------------------------------------------------- | -------------------------- | ----------- |
| **S1 Mask**                   | `src/core/mask/`                                            | contracts                  | immediately |
| **S2 Path**                   | `src/core/path/`                                            | contracts + mask fixtures  | immediately |
| **S3 Segments & orientation** | `src/core/segment/`, `src/core/orient/`, `src/core/color/`  | contracts + path fixtures  | immediately |
| **S4 Validation & harness**   | `src/core/validate/`, `src/core/metrics.ts`, `src/harness/` | contracts + board fixtures | immediately |
| **S5 Renderer**               | `src/render/`                                               | contracts + board fixtures | immediately |
| **S6 App, game loop, PWA**    | `src/game/`, `src/ui/`, `src/pwa/`                          | contracts + board fixtures | immediately |
| **S7 Infra**                  | `.github/`, `.claude/`, root config, `scripts/`             | —                          | immediately |

Every stream starts at once because every stream can build its own input.
That is the whole trick, and it is worth stating plainly:

> **Fixtures are the parallelism mechanism.** `test/fixtures/` ships
> hand-built masks, paths, and boards, plus small builders that produce them.
> S5 does not wait for a real generator; it renders a fixture board. S3 does not
> wait for S2; it segments a fixture path.

Fixtures are therefore the **first task after contracts**, and they are a shared
file — changes to them follow the contract-change rule.

---

## 4. Sequenced backlog

Full issue list with acceptance criteria:
[the GitHub issues](https://github.com/bencan1a/mazeGame/issues) (#1–#32),
generated from [`scripts/backlog.json`](../scripts/backlog.json).

### Wave 0 — unblock everyone (do first, ideally by the human or one agent)

| Task                                                       | Stream | Why first                         |
| ---------------------------------------------------------- | ------ | --------------------------------- |
| Test fixture builders: `makeMask`, `makePath`, `makeBoard` | S4     | Every other stream imports these  |
| Blob generator (crude is fine)                             | S1     | S2 needs _some_ mask to path-fill |
| CI green on an empty implementation                        | S7     | Done in M0                        |

### Wave 1 — the generator (M1)

1. **Mask pipeline** (S1) — blob → largest component → morphological open →
   re-component → hole fill → parity absorption. Each step is its own function
   and its own test. The morphological open is load-bearing (PRD §4.2): a
   1-cell spur makes a Hamiltonian path impossible, so the test that matters is
   "no cell in the repaired mask has fewer than 2 inside-neighbours".
2. **Path fill** (S2) — spanning-tree contour first, since it is _guaranteed_
   and linear. Backbite second, as the randomizer and the fallback for regions
   that will not tile into 2×2 blocks.
3. **Cut and orient** (S3) — cut the path by `meanPieceLength` /
   `pieceLengthVariance`, with `minPieceLength` as a floor and honouring
   `minStraightRun`, choosing each segment's head at the same moment as its
   cut so that acyclicity is constructed rather than searched for.
4. **Blocking digraph** (S3) — ray-walk `occupancy` from each head; CSR out.
5. **Coloring** (S3) — greedy over the adjacency graph, 4–6 hues. This is a
   readability mechanic (PRD §3.3), so the test asserts no two adjacent
   segments share a hue, not merely that colors were assigned.
6. **Validation** (S4) — acyclicity, coverage, reachability, determinism.
   Throws `BoardInvariantError`. Runs in dev and in every test.

### Wave 2 — knowing whether it is any good (M2)

8. **Metrics** (S4) — DAG depth, mean/min free-set size, bend rate, coverage,
   generation time. All fall out of a topological sort that is already running.
9. **Headless sweep CLI** (S4) — `npm run harness -- --sweep`, parameters in,
   CSV/JSON out. No rendering, no React.
10. **Sweep report** (human + S4) — run the space, write down which regions
    produce which difficulty, and report generation time at 100×100. The sweep
    settles the _generation_ half of G3 and nothing else; frame rate and memory
    are Task 12a.
11. **R1 spike** (S2) — `bendProbability` is not natively controllable by the
    contour method. Try weighted Prim favouring straight continuation; if the
    achieved bend rate does not track the requested one, try backbite with
    annealing. **Resolve early** — it is a headline tuning knob and the answer
    changes what the dev panel can honestly offer.

### Wave 3 — making it playable (M3), runs alongside Waves 1–2

12. **Canvas performance spike** (S5) — **do this first, and early.** A bare
    benchmark page: allocate a 3000×3000 offscreen canvas, draw a few hundred
    synthetic polylines into it, and blit it per frame under a simulated
    pan/zoom. No generator, no renderer, no React — so it can run in Wave 1
    alongside the mask work. It answers whether the two-layer + `drawImage`
    architecture holds on real iOS hardware at all, which is the assumption
    every other Wave 3 task is built on top of. Settles R5 and the frame-rate
    half of R3 while both are still cheap to act on.
13. **Two-layer canvas renderer** (S5) — static offscreen layer for idle
    segments, animation layer for the one segment leaving. Pan/zoom is a single
    `drawImage` with source/dest rects, never a re-render.
14. **Arrowheads and legibility** (S5) — ~8–10 CSS px minimum; below that, zoom
    is mandatory (R4). Measure it, don't estimate it.
15. **Pan/zoom input** (S5/S6) — pinch and drag, with the buffer-size cap and
    graceful degradation from R5.
16. **Snake-out animation** (S5) — polyline + exit ray concatenated, animated
    via dash offset.
17. **Hit testing + tap radius** (S6) — pixel → cell → `occupancy` → segment.
    The radius search **must only snap to free segments**; snapping to a blocked
    one costs a life the player never chose to risk. No free segment in radius
    is a no-op miss, not a bounce.
18. **Game loop** (S6) — tap queue during animation, bounce, lives, win, restart
    on the same seed.
19. **Device performance pass** (S5) — 100×100 generation time, pan/zoom frame
    rate, and peak memory on real hardware, with the buffer cap validated by
    forcing it. This is the G3 gate and it belongs here, not at the end: it is
    the one PoC goal that can require an architectural change rather than a
    tuning change, so late is expensive.

### Wave 4 — tuning and shipping the PoC (M4, M5)

20. **Dev settings panel** (S6) — live params, immediate regenerate, metrics
    readout.
21. **Offline / PWA** (S6) — service worker, install path, state persistence of
    `(seed, params, removed segments, lives)`, and the airplane-mode acceptance
    test from PRD §3.5 run on a real device.
22. **Playtest rounds** (human) — structured sessions across the parameter
    regions the sweep identified. Log in `docs/playtest/`.
23. **Verdict** (human) — `docs/VERDICT.md`: chosen defaults, the grid sizes that
    hold performance, whether pan-and-judge is tense or just annoying, and what
    a v1 would need.

---

## 5. Risk handling

The PRD's risks map onto scheduled work rather than sitting in a table:

| Risk                                  | Where it is handled                                     | Trigger for the fallback                                                            |
| ------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| R1 `bendProbability` not controllable | Task 11, a Wave 2 spike                                 | Achieved bend rate does not track requested across ≥ 3 settings                     |
| R2 Orientation search won't converge  | Retired by #83: acyclicity is constructed, not searched | —                                                                                   |
| R3 100×100 doesn't hold performance   | Task 12 spike early, Task 19 device pass                | Generation over 1s, frame rate under 60fps, or memory over the cap on real hardware |
| R4 Legibility floor                   | Task 14, measured on device                             | Arrowheads unreadable below 8 CSS px → zoom becomes mandatory UI, not optional      |
| R5 iOS buffer memory                  | Task 12 spike, Task 15 buffer cap, Task 19 pass         | Buffer would exceed the cap → degrade to re-render on zoom                          |

Two additional risks this plan adds:

| #   | Risk                                                                                                                                                         | Mitigation                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6  | **Parallel agents drift the contracts.** Six agents editing shared types is how a codebase becomes incoherent.                                               | `src/core/types.ts` and `test/fixtures/` are contract-owned: changes need a `contract-change` issue and human review (WORKFLOW.md).                     |
| R7  | **The generator picks up React or DOM coupling**, and the tuning harness dies with it. PRD §4.6 flags this as the rule most likely to be broken in week two. | Enforced mechanically: ESLint bans `react`, `window`, `document`, `Math.random`, and `Date.now` inside `src/core/`. Not a convention — a failing build. |

---

## 6. Definition of done (every task)

A task is done when all of these hold. Agents self-check before opening a PR.

- [ ] Behaviour is covered by tests; generator work has **property-based**
      invariant tests, not just examples
- [ ] `npm run verify` passes (format, lint, typecheck, tests, coverage)
- [ ] No new dependency without an issue saying why
- [ ] `src/core/` still imports nothing from `ui/`, `render/`, `game/`
- [ ] Determinism holds: same `(seed, params)` → byte-identical board
- [ ] Public functions have a comment saying _why_, where the why isn't obvious
- [ ] The issue's acceptance criteria are quoted in the PR and checked off

---

## 7. Suggested agent assignment

One agent per stream, running concurrently. Agent definitions live in
`.claude/agents/`.

| Agent                | Stream | First tasks                                         |
| -------------------- | ------ | --------------------------------------------------- |
| `generator-mask`     | S1     | Blob generator, morphology, parity                  |
| `generator-path`     | S2     | Spanning-tree contour, backbite, R1 spike           |
| `generator-topology` | S3     | Segmentation, blocking graph, orientation, coloring |
| `harness-analyst`    | S4     | Fixtures, validation, metrics, sweep CLI            |
| `renderer`           | S5     | Canvas layers, arrowheads, pan/zoom, animation      |
| `game-loop`          | S6     | Hit testing, tap queue, lives, dev panel, PWA       |

The human owns: the PRD, contract changes, the sweep report, playtesting, the
verdict, and merges.

---

## 8. What would make this plan wrong

Worth writing down now, so it is recognisable later:

- **If the contour path method cannot be made bendy** (R1), `bendProbability`
  stops being a tuning knob and the difficulty space is narrower than the PRD
  assumes. That changes the tuning phase, not the architecture.
- **If 100×100 will not hold 60fps or fits inside no sane memory budget** (R3),
  that is an architecture finding, not a game-design one, and it lands on the
  renderer. Grid size is a parameter the player and the dev panel can turn down,
  so nobody has to conclude the game is unplayable — but "just use 50×50" is a
  retreat from a stated PoC goal, and it should be recorded as one rather than
  absorbed silently.
- **If pan-and-judge is frustrating rather than tense** (PRD §8), the ray-trace
  hint moves from deferred to core, and that is a game-design finding the
  metrics harness cannot produce. Only playtesting can, which is why M5 exists.
