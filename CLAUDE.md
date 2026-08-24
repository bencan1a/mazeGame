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

## Talking to the human

The person reading your replies is a technical PM. They decide scope, priority
and trade-offs; they do not need to follow your implementation to do that.
Write for that reader.

**Every reply has at most three parts, in this order:**

1. **What changed** — at most two sentences, in terms of what a player or the
   project can now do. Name the files only if they need to open one.
2. **What you need from them** — a decision, an approval, missing information.
   At most two sentences. Skip it entirely if there is nothing to decide.
3. **Next step** — one sentence: what happens next, or "done, nothing pending".

**Under 80 words.** A limit, not a target to approach. If the reply does not
fit, it is carrying detail that belongs in a PR description, an issue, or a
doc — put it there and link it.

**Having more to say is not an exception.** A long session with six findings
still gets one reply: the single thing that changes what they do next. The rest
waits for a question, an issue or a doc; it does not get appended because it
happens to be true and you happen to know it.

This shape governs conversational replies. It does not override an output
contract an agent definition sets for a structured deliverable — a `reviewer`
findings list, a `sweep` metrics table — which is as long as it needs to be.
Apply the writing rules below to each entry in one, not the length rule to the
whole.

**Lead with impact, not mechanism.** "Taps near a blocked segment no longer
cost a life" beats "added a free-segment filter to the hit-test radius query".
Mechanism goes in the code and the commit message — that is what they are for.

**Leave out the journey.** No recap of approaches you tried, dead ends you
backed out of, bugs you introduced and fixed, or how long something took. The
only exception is when the detour changes what the human must decide — a
contract that has to move, a risk that turned out real, a scope item that
cannot be built as written. Then state the consequence first and keep the
history to one sentence.

**Say plainly when something is unfinished or failing.** Brevity never means
hiding a red `npm run verify`, a skipped requirement or an assumption you made.
One sentence: what is broken or assumed, and what it blocks.

**Use jargon only when it is the shortest true phrasing** and the term is in
`docs/PRD.md` or `docs/CONTRACTS.md` — segment, blocking digraph, seed, mask
are shared vocabulary. Internal terms (CSR, backbite, typed array, property
test) need a plain-language stand-in or a half-sentence gloss.

**Never open with flattery or close with a summary of what you just said.**
No "Great question", no "In summary". Numbers and file paths are welcome; prose
padding is not.

**Example.** Two ways to get this wrong, then the right one.

> Unstructured: "I started by looking at the hit-test code in `src/game/hit.ts`
> and realised the radius query was returning all segments, not just free ones.
> My first fix filtered after sorting, which was wrong because it could return
> an empty set, so I refactored to filter inside the CSR neighbour scan and
> added a property test over 200 generated boards to confirm the invariant
> holds. All tests pass and `npm run verify` is green."

> Right shape, three times too long: "**What changed** — tapping near a blocked
> segment is now a miss rather than a bounce, so a player no longer loses a life
> they never risked. The filter moved inside the CSR neighbour scan, which also
> drops an allocation per tap. **What you need from me** — a call on whether a
> miss should give visual feedback; it is silent today, which tested badly on a
> phone but matches the PRD. Also worth knowing the tap radius is still a
> constant rather than scaled to zoom, which will matter at 100x100. **Next
> step** — I can scale the radius next, or leave it until the renderer lands."

> Right: "Fixed: tapping near a blocked segment is now a miss instead of costing
> a life. Verify is green. Next: your call on whether a miss should give any
> visual feedback — currently it's silent."

The second is the one to watch for. It has the right shape, every sentence in it
is true, and it is still wrong — the surplus detail being real is exactly what
makes it feel safe to include.

## PR descriptions

The first reader of every PR is the `reviewer` agent, and it reads the **diff**.
So the PR body's only job is to carry what a diff physically cannot show. Write
nothing the reviewer could learn by reading the code — that is duplicated tokens
on every review.

The diff already shows what changed, how it was implemented, which files moved,
and that tests exist. Do not narrate any of it.

Four things the diff cannot show, and the body must:

1. **The issue number** (`Closes #N`) — the acceptance criteria live there.
2. **Acceptance criteria, copied verbatim** and ticked. The reviewer checks
   whether they are genuinely met; it cannot do that against criteria it has
   never seen, and a loose restatement is worse than none.
3. **Justification for anything that looks like a rule break** — a shared-file
   edit and its `contract-change` issue, an out-of-lane file, a new runtime
   dependency, a deliberate deviation from an ADR. Without this the reviewer
   must flag it; with one line it can move on.
4. **What you deliberately left undone or are unsure about.** Absence of code is
   invisible in a diff.

Everything else is silence. Two sentences of "what changed" for the human is the
ceiling — no design essays, no file-by-file tour, no restating the test names.

Issue comments follow the reply rules above: impact first, decision needed,
next step.

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
- **Write fewer comments.** A comment earns its place only when it says
  something a reader cannot check against the lines beside it and would not
  work out from the code in a few seconds. "Explains why" is not enough of a
  filter: most wrong comments are nominally why.
- **A comment may not point outside its own file.** No PRD sections, ADR
  numbers, issue or AC numbers, stream or risk labels (`S1`..`S7`, `R1`..`R3`),
  no paths into `docs/`. Nothing keeps a citation in step with what it cites,
  so it is the part most likely to outlive whatever it described. Reference
  material belongs in `docs/`; a decision worth recording is an ADR, not a
  paragraph in a file header. `npm run lint` fails on these —
  `eslint-rules/no-comment-cross-references.js`.
- **Four things never go in a comment**, however well they explain:
  - a bound or a proof written out in prose — put the check in code, or let
    the test carry it;
  - a rejected alternative;
  - an invariant said to be guaranteed somewhere else — where the guarantee
    matters, the check in code _is_ the guarantee, and prose beside it is a
    second copy, free to drift out of agreement with it;
  - the history of the code: what an earlier version did, what a review found,
    what a measurement read on somebody's machine.
- **What does earn its place**: a layout convention a type cannot express
  (1-based ids, CSR offsets, `tail -> head` order); language or platform
  behaviour that reads as a bug otherwise (a `Direction` in a `Uint8Array`
  arriving as 255, `NaN` surviving a clamp); and the derivation behind a
  hand-computed expected value in a test.
- **A comment that misdescribes the code is a defect, ranked with a logic
  error, not a nit.** Nothing executes prose, so a confident wrong comment
  survives review that wrong code would not, and then misleads whoever trusts
  it. Volume is what makes wrongness likely — hence the rules above.

## Working here

- One issue → one branch `agent/<stream>/<issue>-<slug>` → one PR. Claim by
  assigning yourself before writing code.
- **Stay in your lane.** File ownership is in `docs/WORKFLOW.md`. Need something
  from another stream? Open an issue against it and use a fixture meanwhile.
- **Shared files** (`src/core/types.ts`, `src/core/generate.ts`, `rng.ts`,
  `grid.ts`, `test/fixtures/**`) need a `contract-change` issue and human
  review, in a PR of their own with no feature work attached.
- **Documentation is not a shared file for that purpose.** Recording a
  measurement, a decision or a finding in `docs/` goes in the same PR as the
  work that produced it, with no issue and no split. What the rule above
  protects is an interface other lanes compile against; prose is not one, and
  separating a note from its evidence only makes it likelier to rot. The one
  exception is a change to what `docs/CONTRACTS.md` **specifies** — that is an
  interface, and it takes the rule above.
- `npm run verify` passes locally before you push.
- Do not merge or approve PRs.
- No new runtime dependency without an issue justifying it — offline is a
  first-class requirement and every dependency is bundle weight.
- Out of scope for the PoC: levels, scoring, sound, accounts, image import,
  silhouette library (PRD §8). Open an issue instead of building them.

## Known traps

- **`bendProbability` steers the contour path but is not a target rate.** It
  biases the spanning tree toward turning, monotonically but not linearly, and
  the reachable band depends on the board. The ceiling sits near 0.48 at every
  size; the floor rises as the board shrinks, because a small region's own
  boundary forces corners — around 0.06 at gridSize 100 but 0.26 at 20, where
  no setting will give you a straight-looking board. Check the measured
  `bendRate`. The backbite fallback ignores the parameter entirely.
- **Cut placement blind to the blocking digraph does not work** above roughly
  20x20 — it produces segmentations with no acyclic orientation at all, which no
  orienter can rescue. The cut and the head are chosen together for that reason,
  and acyclicity is constructed rather than searched for (this retires R2).
- **The tap radius must only ever snap to a _free_ segment.** Snapping to a
  blocked one costs a life the player never chose to risk. No free segment in
  radius is a no-op miss, not a bounce.
- **100×100 is a performance risk, not a playability one** (R3, amended by
  [ADR-0006](docs/adr/0006-grid-size-is-a-parameter.md)). Grid size is a
  parameter the player can turn down, so a long board at a large size is a
  setting, not a defect. Generation, frame rate and memory have all now been
  measured; the headless harness settles generation time only, and the rest
  came off a phone.
- **The canvas limit is per buffer, not a memory budget.** Measured on iOS: one
  8192x8192 canvas holds and one 10000x10000 comes back blank, while two
  8192x8192 canvases held at once are fine. So size each layer under the cap
  rather than budgeting a total, and never trust allocation to throw — an
  over-budget canvas is returned blank, and only reading a drawn pixel back
  detects it.
