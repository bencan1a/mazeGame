# ADR-0008: PR currency is enforced by branch protection, not by re-running CI

**Status:** Accepted

## Context

`main` went red at `3389d46`. #53 made `fillFraction` required on `GenParams`;
#57 added a `GenParams` literal naming every field. Both were green on their own
branches, git merged both without conflict, and the combination did not compile.
No per-branch check could have caught it — the defect only exists once both are
on `main`.

The obvious fix is to re-run CI on open PRs whenever `main` moves, so a green
tick can never be arbitrarily stale. Two things happened before that got built.

**Branch protection was turned on**, with required up-to-date branches. A PR now
cannot merge unless its branch contains current `main` and the checks passed on
that head. So the failure mode above is closed at the merge button: a semantic
conflict can no longer reach `main` the way #62's did. Re-running CI when `main`
moves does not add to that. It only tells the author sooner — they would learn
the same thing when they went to merge.

**The cost was measured**, by replaying the policy over this repo's real merge
history. Over the 19 merges from #33 to #65, with a peak of 9 PRs open at once
and a mean of 3.3:

|                                                   | extra CI runs |
| ------------------------------------------------- | ------------- |
| Re-check every open PR                            | 63            |
| Re-check only PRs the merge could plausibly break | 20            |

A CI run here takes 30–45s, so that is roughly 37 minutes of runner time for the
naive version and 12 for a filtered one — per session, for earlier notice of
something already enforced. The filtered version also needs its own filter to be
right: #53 and #57 shared no file at all, so file overlap alone would have missed
the very case it exists for, and it has to fall back to "any shared contract or
build file re-checks everything" — which is most of the interesting merges.

## Decision

**Currency is a branch-level requirement, not a CI mechanism.** Required
up-to-date branches plus a required check is the whole enforcement. Nothing
re-dispatches CI on open PRs when `main` moves, and no workflow pushes to a
contributor's branch.

The one thing that does run on push to `main` is
`scripts/verify-merge-landed.mjs`: it asserts the merged branch's tip is an
ancestor of `main`. That is a different failure — #48 merged the commit before
three fixes pushed mid-merge, and lost `a6435f1`. Branch protection should
prevent it too, since a push invalidates the required check; this confirms that
it does, in one job with no `npm install`, while the branch still exists to
recover from.

## Consequences

- With several PRs open, every merge makes the rest out of date, and each author
  merges `main` in and waits for their own checks. That serialisation is real,
  and it is the cost of the guarantee — re-running CI centrally would not have
  removed it, only moved the notification earlier.
- If that becomes the bottleneck, the answer is fewer PRs open at once or fewer
  shared-file changes, not a looser merge rule.
- Revisit if branch protection is ever relaxed, or if a semantic conflict reaches
  `main` again despite it. The numbers above are what a re-check would cost;
  re-measure before building one, because they scale with how many PRs run in
  parallel.
