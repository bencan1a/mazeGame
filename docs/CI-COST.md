# What re-checking open PRs costs

Re-running CI on open PRs every time `main` moves is the mechanism that would
have caught #62 — two PRs each green on their own branch, merged cleanly by
git, that did not compile together. The obvious version of it re-dispatches
every open PR on every push and is O(open PRs) runs per merge, which is the
kind of thing that gets switched off the first time it is annoying. So the
number comes first.

## The policy

`.github/workflows/base-moved.yml` runs on push to `main` and re-checks an open
PR only when the merge can plausibly break it:

- the merge touched a **shared contract or build file** (`src/core/types.ts`,
  `rng.ts`, `grid.ts`, `generate.ts`, `test/fixtures/**`, `package.json`,
  the tsconfigs, the lint/format/vitest/vite config, `ci.yml`) → every open PR
  is re-checked, because those break code that never names them;
- otherwise → only PRs whose own changed files intersect the merge's.

The list lives in `scripts/lib/pr-recheck.mjs`. Re-checking means merging the PR
into current `main` in a throwaway checkout, running `npm run verify`, and
posting the result as a commit status on the PR's head. It never pushes to the
branch: a push from `GITHUB_TOKEN` does not re-trigger CI, and it would reset
approvals and race whoever is working there. Label a PR `no-auto-recheck` to opt
out.

## Measured

`node scripts/ci-cost.mjs` replays the policy over this repo's real merge
history, from git alone — a branch counts as open from its first commit, which
over-estimates slightly and so bounds the cost from above.

Over the 19 merges from #33 to #65:

|                                    |      |
| ---------------------------------- | ---- |
| Peak open PRs at one merge         | 9    |
| Mean open PRs per merge            | 3.32 |
| Extra runs, re-check every open PR | 63   |
| Extra runs, this policy            | 20   |
| Saved                              | 43   |

Twenty extra runs over the whole session — about **1.1 per merge**, against 3.3
for the naive version. A CI run on this repo took 30–45s wall clock, so the
policy costs roughly **12 minutes** of runner time across the session where
re-checking everything would have cost about 37.

The 20 are concentrated in four merges — #40, #45, #50 and #53 — each because
it touched a shared contract or build file. The other fifteen re-checked
nothing at all.

## Does it catch the thing it exists for?

Yes. #53 made `fillFraction` required in `src/core/types.ts` and merged at
22:02 with eight PRs open, #57 among them. That is a shared contract file, so
all eight would have been re-checked, and #57's `GenParams` literal would have
failed typecheck on its own PR at 22:02 instead of turning `main` red at 22:30.
`scripts/lib/pr-recheck.test.ts` pins that case.

## When to re-measure

Re-run `node scripts/ci-cost.mjs` after a session with more parallel agents, or
if CI grows past a couple of minutes. The policy is worth keeping while the
extra-run count stays near one per merge; if a stream starts touching shared
files routinely it will climb, and the answer then is fewer shared-file changes
rather than a looser filter.
