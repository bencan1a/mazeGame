# Working agreement — one human, several agents

This repo is built by one person plus several Claude agents running at the same
time. Everything below exists to stop concurrent agents from producing work that
does not compose.

## Source of truth

**GitHub Issues.** One issue = one unit of work = one branch = one PR.
Seeded: **#1–#32**. [`docs/backlog.md`](./backlog.md) is the readable index and
the seed for the issue list; now that the issues exist, the issues win.
Reconcile with `node scripts/seed-github.mjs --dry-run`.

Labels:

| Label                          | Meaning                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `stream:mask` … `stream:infra` | Which lane owns it — see the ownership table below            |
| `wave:0` … `wave:4`            | Sequencing from [PLAN.md](./PLAN.md#4-sequenced-backlog)      |
| `contract-change`              | Touches shared files; needs human review before merge         |
| `spike`                        | Time-boxed investigation; the deliverable is a written answer |
| `blocked`                      | Waiting on another issue — say which in a comment             |
| `risk:R1` … `risk:R7`          | Ties the work to a PRD/plan risk                              |

Milestones map to M0–M5 in the plan.

## The loop, per task

1. **Claim.** Assign the issue to yourself and comment `claiming` before writing
   code. An unassigned issue is fair game; an assigned one is not.
2. **Branch.** `agent/<stream>/<issue-number>-<slug>`, e.g.
   `agent/path/23-spanning-tree-contour`. Branch from the latest `main`.
3. **Build.** Small commits, present tense, imperative
   (`add morphological open to mask pipeline`).
4. **Verify.** `npm run verify` must pass locally before you push. A push that
   turns CI red costs everyone a cycle.
5. **PR.** Fill in the template. Quote the issue's acceptance criteria and check
   them off. Link with `Closes #23`.
6. **Review.** The automated reviewer runs on every PR and either approves it or
   requests changes — criteria in [`REVIEW.md`](../REVIEW.md). Address what it
   raises and push; the stale approval is dismissed and it reviews again.
7. **Merge.** Human merges. As an author you do not merge, approve, or
   self-review — the reviewer that votes is a separate actor running on the PR,
   not the agent that wrote the code.

## File ownership

Concurrency works because streams do not share files. Stay in your lane.

| Path                                                                                                                  | Owner                             |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `src/core/mask/**`                                                                                                    | S1 mask                           |
| `src/core/path/**`                                                                                                    | S2 path                           |
| `src/core/segment/**`, `src/core/orient/**`, `src/core/color/**`                                                      | S3 topology                       |
| `src/core/validate/**`, `src/core/metrics.ts`, `src/harness/**`                                                       | S4 harness                        |
| `src/render/**`                                                                                                       | S5 renderer                       |
| `src/game/**`, `src/ui/**`, `src/pwa/**`                                                                              | S6 app                            |
| `.github/**`, `.claude/**`, root config, `scripts/**`                                                                 | S7 infra                          |
| **`src/core/types.ts`, `src/core/generate.ts`, `src/core/rng.ts`, `src/core/grid.ts`, `test/fixtures/**`, `docs/**`** | **shared — contract rules apply** |

Need something from another lane? Do not reach in and change it. Open an issue
against that lane, label it `blocked`, and work around it with a fixture
meanwhile. That is what fixtures are for.

## Changing a contract

Shared files are the one place where parallel work can genuinely break. So:

1. Open an issue labelled `contract-change` describing the change and who it
   affects.
2. Wait for the human to accept it. This is the one place where blocking on a
   human is correct.
3. Land the type change and the fixture updates in a **single small PR**, on its
   own, with no feature work attached.
4. Say so in the issues of every stream affected.

A contract PR that also contains feature work will be sent back, because it
cannot be reviewed for the thing that actually matters.

## Rules an agent must not break

These are the ones that cost real time when broken, so they are enforced
mechanically wherever possible:

- **`src/core/` stays pure.** No React, no `window`, no `document`, no
  `Math.random`, no `Date.now`. ESLint fails the build. (PRD §4.6, ADR-0004.)
- **React never re-renders the board.** Canvas lives behind an uncontrolled ref.
  (ADR-0002.)
- **Typed arrays and CSR, from the start**, not as a retrofit. (ADR-0003.)
- **Boards are deterministic.** Same `(seed, params)` → identical board. If a
  test needs randomness, seed it.
- **No new runtime dependency** without an issue justifying it. Offline is a
  first-class requirement and every dependency is bundle weight.
- **No scope creep into PRD §8 deferred work.** Levels, scoring, sound, image
  import, and a silhouette library are all out. Open an issue instead.
- **Do not merge your own PR.** Do not approve PRs. The automated PR reviewer is
  the only Claude actor that votes. Note that it _will_ approve work you pushed,
  since a PR pushed from your session is authored by the human, not by the
  reviewer — so its approval is the only one that PR gets. Write accordingly.

## Agents and models

Agent definitions live in `.claude/agents/`. The six stream agents run on
**Sonnet**; the `reviewer` agent runs on **Opus**.

The split is deliberate. Stream work here is well-specified — a contract to code
against, postconditions written down, property tests that say when it is right —
which is the shape Sonnet handles well and cheaply. Review is the opposite: an
open-ended search for the thing nobody thought to specify, where the failure mode
is a quiet miss rather than a visible error. That is worth the stronger model,
and it is one agent rather than six.

**Five issues are worth escalating if a Sonnet run stalls.** They are
algorithmically dense rather than merely fiddly, and the failure is usually
subtle-and-plausible rather than obviously broken:

| Issue                        | Why                                                                        |
| ---------------------------- | -------------------------------------------------------------------------- |
| #4 parity absorption         | Choosing which cells to drop while preserving 4-connectivity               |
| #5 spanning-tree contour     | Half-resolution tree, full-resolution contour trace, 2×2 tiling constraint |
| #6 backbite                  | Tail reversal that must preserve the Hamiltonian property on every move    |
| #10 orientation local search | Tarjan SCC plus a search whose correctness condition is global             |
| #11 reverse construction     | Correct by construction only if the insertion argument actually holds      |

Escalate by overriding the model on that invocation, not by editing the agent
definition — the default should stay Sonnet.

## Testing expectations

- Generator work needs **property-based invariant tests** (`fast-check`), not
  only examples. The invariants are in [CONTRACTS.md](./CONTRACTS.md).
- Coverage gate is on `src/core/**` only. Chrome is deliberately exempt —
  gating rendering coverage produces tests that assert nothing.
- Every bug fix starts with a failing test that reproduces it.
- Tests state the invariant in the name: `path visits every mask cell exactly
once` beats `test buildPath`.

## When you are stuck

Say so in the issue, with what you tried. Three specific cases have a defined
answer already:

- **Orientation search will not converge** → switch to reverse construction
  (R2). It is scheduled work, not an emergency.
- **The contour method will not tile the region** → backbite fallback (S2).
- **`bendProbability` does not track the achieved bend rate** → that is R1;
  record the numbers in the spike issue rather than tuning by feel.

## Definition of done

Copied into every PR by the template:

- [ ] Acceptance criteria from the issue, quoted and checked
- [ ] `npm run verify` green
- [ ] Property tests for generator invariants
- [ ] No cross-lane file edits (or a `contract-change` issue linked)
- [ ] Determinism preserved
- [ ] No new dependency without justification
