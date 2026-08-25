# M4 — Tunable & offline: delivery plan

M4's gate is "dev panel regenerates live; airplane-mode acceptance test
passes" ([PLAN.md](./PLAN.md) §2). Four issues carry it:

| Issue                                                                   | Stream       | Notes                                          |
| ----------------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| [#27](https://github.com/bencan1a/mazeGame/issues/27) Dev tuning panel  | stream:app   | Live params, immediate regenerate, metrics     |
| [#28](https://github.com/bencan1a/mazeGame/issues/28) State persistence | stream:app   | (seed, params, removed, lives) across a reload |
| [#29](https://github.com/bencan1a/mazeGame/issues/29) Offline / PWA     | stream:app   | Install path plus the on-device acceptance run |
| [#21](https://github.com/bencan1a/mazeGame/issues/21) Browser tests     | stream:infra | Playwright on headless Chromium in CI          |

## What the codebase already gives us

Three things change the shape of the plan and are worth stating before the
sequencing, because two of them are further along than the issues assume and
one is further behind.

**Offline is mostly built.** `vite.config.ts` already configures
`vite-plugin-pwa` with `registerType: 'autoUpdate'`, `injectRegister: 'auto'`,
a full manifest, three icons, and a `navigateFallback` under the deployed base
path; `deploy.yml` sets `VITE_BASE` to `/mazeGame/`. Registration is injected
into `index.html` at build time, so no app code registers the worker and none
needs to. What #29 is actually missing is the **install path** (there is no
prompt and no instructions anywhere in `src/ui/`), the devtools no-network
trace, and the device run itself.

**Metrics need no contract change.** `computeMetrics` wants a `Mask` and a
`HamiltonianPath` that a finished `Board` does not carry, and
`generateBoardWithDiagnostics` already returns both. The panel gets its
readout by switching the controller from `generateBoard` to the diagnostics
variant and timing the call. No shared file is touched.

**But the controller cannot be reconfigured or restored.**
`createBoardController` takes `genParams` and `playParams` at construction,
binds `const board`, and builds its `GameState` with `createGameState`, which
only ever starts a fresh game. There is no way to hand it new params, and no
way to start it from a saved removed-set and life count. #27 needs the first,
#28 needs the second, and both are the same seam in the same two files. That
is the one real ordering constraint in M4.

## Track A — the app lane (`src/game/`, `src/ui/`)

Serial, one `game-loop` agent. Each step is its own issue, branch and PR.

**A0. Reconfigure-and-restore seam.** No user-visible change. Add a restore
constructor beside `createGameState` in `src/game/state.ts` that takes a
removed-set and a life count and rebuilds the derived fields; give
`BoardController` a `reconfigure(genParams, playParams)` that tears down the
static layer and rebuilds the board in place; move the controller onto
`generateBoardWithDiagnostics` and expose `mask`/`path`/`generationMs` so the
panel can measure. Property test: restore of a state's own snapshot is
identical to that state.

Small, but it unblocks both of the next two, and landing it separately is what
lets them be reviewed as feature work rather than as refactors with a feature
attached.

**A1. #28 persistence.** New `src/game/persistence.ts`: a versioned record of
`(seed, params, removedSegments, lives)`, `localStorage` behind try/catch on
both read and write, written on every settled outcome. A record whose
`params` shape or version does not match is discarded, not migrated — the
board is a pure function of its params, so a partial match would restore a
different board under the same seed. Restore verifies the regenerated board's
`segmentCount` against the record before applying the removed-set.

**A2. #27 dev panel.** New `src/ui/DevPanel.tsx`, collapsed by default,
calling `controller.reconfigure` on change. Two things the issue's comment is
right to insist on: label `bendProbability` as a steer and show the achieved
`bendRate` beside it, and label `minPieceLength` and `meanPieceLength` the
same way — `GenParams` documents all three as targets the generator gives up
under pressure, not settings.

**A3. #29 install path.** An install button behind `beforeinstallprompt`, and
static iOS instructions for Safari, which fires no such event. Smallest piece
in M4; it can be folded into A2's PR if the panel lands first.

A1 and A2 can run as two agents once A0 is merged, but they both wire into
`BoardMount.tsx`. If they do run concurrently, A2 owns that file and A1 stays
inside `src/game/` behind a callback the controller already holds.

## Track B — the infra lane (`e2e/`, `.github/`)

Runs from day one, in parallel with A0. Zero file overlap with Track A.

**B1. #21a — runner and everything testable today.** Playwright as a dev
dependency, a `playwright.config.ts`, a CI job, and six of the eight criteria:
service-worker registration and an offline second load, manifest/scope/
`start_url` under the base path, a synthetic tap resolving to the expected
segment on a fixture board, bounce/lives/win transitions, and visual
regression with a tolerance loose enough to survive runner antialiasing. All
of this tests behaviour that exists on `main` right now.

**B2. #21b — the persistence test.** The one criterion that waits on A1.

Splitting #21 this way is what keeps the infra agent off the critical path
instead of idling behind the app lane. CI needs `playwright install --with-deps
chromium` in the job; the runner has no browser preinstalled.

## Track C — device and decisions (human)

**C1. No-network trace.** Load the deployed build, play a board with the
network tab open, confirm zero requests. Runnable now, needs no M4 code.

**C2. The M4 acceptance test.** Load once, airplane mode, force-quit, relaunch,
resume mid-game with lives intact, then generate a fresh board. This is the
gate, and it needs A1 deployed to Pages — nothing resumes mid-game before
persistence exists. Record the result in #29.

**C3. One decision, worth taking early.** #27's comment asks the panel to
surface which path method produced the current board, because a board that
fell through to backbite ignores `bendProbability` entirely and the slider
will look broken on exactly those seeds. Nothing reports that today:
`GenerateBoardDiagnostics` carries `attempts`, `attemptFailures` and `peel`,
and neither path builder returns its identity. Surfacing it means adding a
field to `src/core/generate.ts` — a shared file, so a `contract-change` issue
and a PR of its own. The alternative is to ship the achieved `bendRate` beside
the slider and accept that a backbite board looks unresponsive. Either is
defensible; the contract change is small and the panel is the instrument the
whole tuning phase runs on.

## Critical path

```
A0 seam ──> A1 persistence ──> deploy to Pages ──> C2 acceptance test  [M4 gate]
        └─> A2 dev panel ──> A3 install path
B1 runner ────────────────────> B2 persistence test
C1 no-network trace  (any time)
C3 contract-change decision  (now, blocks nothing but shapes A2)
```

Three lanes run concurrently from the start; only C2 is genuinely gated, and
only on A1. The gate is reached as soon as persistence ships and one phone
runs the test — the dev panel is on the milestone but not on its critical
path.
