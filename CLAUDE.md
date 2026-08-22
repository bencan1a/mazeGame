# Arrow Maze — agent guide

Offline, phone-first arrow maze puzzle. Full spec in [`docs/PRD.md`](docs/PRD.md).

**Read before writing code:** [`docs/WORKFLOW.md`](docs/WORKFLOW.md) (how work is
claimed and merged) and [`docs/CONTRACTS.md`](docs/CONTRACTS.md) (the interfaces
you code against). This repo is built by one human plus several agents at the
same time — the process exists so concurrent work composes.

## The game in four sentences

A silhouette is tiled by one space-filling path cut into segments, each with an
arrowhead at one end. Tap a segment: if the forward ray from its head to the
board edge is clear of other segments, it snakes out and leaves; if anything
sits on that ray, it bounces and costs a life. A segment's own body never blocks
it, so a clear head guarantees escape. Clear every segment to win; lose all
lives and the board restarts **with the same seed**.

Removals only ever unblock, so the blocking relation is a static digraph and the
puzzle is solvable **iff that digraph is acyclic**. Difficulty is therefore not
combinatorial — it is visual search across a dense field. Design and tune for
that.

## Commands

```sh
npm install
npm run dev          # vite dev server
npm run verify       # format + lint + typecheck + tests + coverage — run before every PR
npm test             # vitest
npm run harness      # headless generator sweep, no DOM
npm run build        # production build incl. service worker
npm run budget       # bundle size budget (CI gate)
npm run dev -- --host  # serve on the LAN, to open on a phone
```

Deployed build: <https://bencan1a.github.io/mazeGame/>. Read
[`docs/TESTING.md`](docs/TESTING.md) before claiming anything about
performance — **CI cannot measure frame rate or memory**, and a number from a
headless Linux runner is not evidence about a phone.

## Layout

```
src/core/      pure generator: mask -> path -> segmentation -> orientation -> validation -> colors
src/harness/   headless metrics sweep
src/render/    two-layer canvas renderer
src/game/      tap queue, lives, persistence
src/ui/        React chrome only
test/fixtures/ synthetic masks/paths/boards — how streams work in parallel
docs/          PRD, plan, architecture, contracts, workflow, ADRs, backlog
```

## Rules that fail the build if broken

1. **`src/core/` is a pure function of `(seed, params)`.** No React, no `window`,
   no `document`, no `Math.random`, no `Date.now`. Use `createRng(seed)`. The
   generator must be callable identically from the dev panel, a headless script,
   and the game loop — that is what the tuning harness depends on.
   ([ADR-0004](docs/adr/0004-generator-purity.md))
2. **React never re-renders the board.** Canvas behind an uncontrolled ref.
   React owns chrome only. ([ADR-0002](docs/adr/0002-canvas-not-svg.md))
3. **Typed arrays and CSR everywhere**, from the start, not as a retrofit.
   ([ADR-0003](docs/adr/0003-typed-arrays-csr.md))

## Conventions

- A cell is `y * width + x`. Use `src/core/grid.ts` for index arithmetic — do not
  re-derive it inline. `step()` exists because `index - 1` at `x === 0` silently
  wraps to the previous row.
- Segment ids are 1-based; `occupancy[i] === 0` means empty.
- Directions: `0=N 1=E 2=S 3=W`.
- Generator work needs **property-based** invariant tests (`fast-check`), not
  only examples. The invariants are listed in `docs/CONTRACTS.md`.
- Comments explain _why_. The what is in the code.

## Working here

- One issue → one branch `agent/<stream>/<issue>-<slug>` → one PR. Claim by
  assigning yourself before writing code.
- **Stay in your lane.** File ownership is in `docs/WORKFLOW.md`. Need something
  from another stream? Open an issue against it and use a fixture meanwhile.
- **Shared files** (`src/core/types.ts`, `src/core/generate.ts`, `rng.ts`,
  `grid.ts`, `test/fixtures/**`, `docs/**`) need a `contract-change` issue and
  human review, in a PR of their own with no feature work attached.
- `npm run verify` passes locally before you push.
- Do not merge or approve PRs.
- No new runtime dependency without an issue justifying it — offline is a
  first-class requirement and every dependency is bundle weight.
- Out of scope for the PoC: levels, scoring, sound, accounts, image import,
  silhouette library (PRD §8). Open an issue instead of building them.

## Known traps

- **`bendProbability` is not natively controllable** by the contour path method
  (R1). If you are tuning it, check the measured `bendRate` rather than trusting
  the parameter.
- **Orientation search may not converge** (R2). It is time-boxed; the fallback
  to reverse construction is built, not hypothetical.
- **The tap radius must only ever snap to a _free_ segment.** Snapping to a
  blocked one costs a life the player never chose to risk. No free segment in
  radius is a no-op miss, not a bounce.
- **100×100 is a performance risk, not a playability one** (R3, amended by
  [ADR-0006](docs/adr/0006-grid-size-is-a-parameter.md)). Grid size is a
  parameter the player can turn down, so a long board at a large size is a
  setting, not a defect. What is at risk is generation under 1s, 60fps pan and
  zoom, and buffer memory on iOS. The headless harness settles generation time
  only — frame rate and memory need a device.
