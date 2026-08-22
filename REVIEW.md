# Review instructions

How the automated reviewer (`.github/workflows/claude-review.yml`) decides
whether a PR merges. The `reviewer` agent in `.claude/agents/reviewer.md` applies
the same checklist locally, so a clean pre-flight run should mean a clean vote.

## The vote

**Approve** when nothing blocking is found. **Request changes** when something is.
Approval is a merge authorization, not a courtesy — this repo requires one
approval and the reviewer is usually the one giving it.

Do not block on anything CI already settles. `npm run verify` gates format, lint,
typecheck, tests, coverage, build, and bundle budget, and the `verify` check must
be green to merge regardless. Repeating those findings costs the author a round
trip and tells them nothing.

## What blocks

A blocking finding names the input or state that triggers it and the wrong
behaviour that results. If that sentence cannot be written, it is a nit.

The first three cost the most time here, so check them first:

1. **`src/core/` purity.** No React, DOM, `window`, `document`, `Math.random`, or
   `Date.now` anywhere in the generator's call tree. ESLint catches direct cases;
   look for laundered ones — a clock value threaded in from a caller, a seed
   derived from something nondeterministic. ([ADR-0004](docs/adr/0004-generator-purity.md))
2. **React/canvas boundary.** No per-segment React state, no board re-render
   through React, canvas behind an uncontrolled ref. ([ADR-0002](docs/adr/0002-canvas-not-svg.md))
3. **Typed arrays and CSR.** No per-cell or per-segment object allocation
   introduced in a hot path. ([ADR-0003](docs/adr/0003-typed-arrays-csr.md))
4. **Determinism.** Same `(seed, params)` must give an identical board. Any new
   randomness seeded through `createRng`.
5. **Lane discipline.** Files edited outside the PR's stream, per the ownership
   table in [`docs/WORKFLOW.md`](docs/WORKFLOW.md). A shared-file edit
   (`src/core/types.ts`, `generate.ts`, `rng.ts`, `grid.ts`, `test/fixtures/**`,
   `docs/**`) with no linked `contract-change` issue blocks — that convention is
   what keeps six parallel streams composing.
6. **Correctness.** Logic errors producing wrong output or corrupt state;
   crashes, unhandled errors, resource leaks, unbounded growth; index arithmetic
   that wraps rows instead of using `grid.ts`; a breaking contract change with no
   migration path.
7. **Silent failure modes.** New behaviour that fails quietly and has no test
   covering it. Generator changes need property-based invariant tests
   (`fast-check`), not only examples — the invariants are in
   [`docs/CONTRACTS.md`](docs/CONTRACTS.md). A bug fix with no failing test
   reproducing it blocks.
8. **Acceptance criteria.** Criteria quoted from the issue and genuinely met, not
   restated loosely and ticked.

Two game-logic traps no lint rule catches, worth checking by hand:

- The tap radius must never snap to a **blocked** segment. No free segment in
  radius is a no-op miss, not a bounce — snapping to a blocked one costs a life
  the player never chose to risk.
- A segment's own body never blocks it, and a segment crossing a ray twice is one
  blocking edge, not two.

## What does not block

Naming, formatting, structure preferences, speculative future problems, and test
coverage that is merely desirable. Scope drift into PRD §8 deferred work (levels,
scoring, sound, accounts, image import, silhouette library) and new runtime
dependencies without justification are worth flagging loudly, but as nits unless
they actually ship in this PR.

## Keeping reviews cheap

- Post at most **five** inline nits. Summarize the rest as a count.
- Judge each change against the surrounding file, not the diff hunk alone. A
  change that looks wrong in isolation is often correct in context.
- Say plainly when nothing was found. Do not manufacture findings to look useful.
- Behaviour claims need a `file:line` citation, not an inference from naming. If
  you are unsure something is a real bug, say so and make it a nit.
- After the first review of a PR, suppress new nits and report blocking findings
  only. A one-line fix should not reach round seven on style.
