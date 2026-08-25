# ADR-0010: The spanning-tree contour is the only path builder

**Status:** Accepted
**Source:** PRD §4.2 step 2
**Amends:** PRD §4.2 step 2 (backbite fallback), ADR-0009 (which weighed backbite as an alternative)

## Context

PRD §4.2 step 2 specified two Hamiltonian path builders: the spanning-tree
contour as the primary, and backbite (Mansfield) as the fallback for regions the
contour cannot tile into 2×2 blocks. Both were built.

[ADR-0009](./0009-half-resolution-silhouette.md) then moved silhouette drawing to
a half-resolution lattice upscaled 2×, which makes every procedurally generated
mask block-aligned **by construction**. That removed the condition the fallback
existed to cover.

Measured over 720 boards — 60 seeds at each of gridSize 20/40/60/100, at
`bendProbability` 0.1/0.6/0.9 and `fillFraction` 0.45 — `buildContourPath`
succeeded on every board and `buildBackbitePath` ran on none. On the masks this
generator actually produces, the fallback is unreachable.

Unreachable is not free:

- It carried its own open defect. On a mask region three cells across, backbite
  stalls short of full coverage: growth from a random start walls off pockets of
  free cells that no reordering of the covered set can reach, and the restart
  re-rolls into the same trap. Reproduced on 3×100 rectangles at 0 of 10 seeds
  within the default move budget, against 10 of 10 at both two and four across.
  It is a property of the algorithm rather than of the region — a 3×N rectangle
  admits a Hamiltonian path trivially, and a hundredfold move budget finds one.
- It forced `bendProbability` to be documented as a steer that only one of the
  two builders reads, on a board whose builder the caller could not predict.
- Every downstream stage had to be correct against two different walk
  distributions, and the segmenter's property tests paid for a second full run
  to prove it.

## Decision

Delete `buildBackbitePath` and its tests. `buildContourPath` is the only path
builder; `generateBoard` calls it and nothing else.

A contour decline now fails the generation attempt with a `path:` reason naming
contour's own reason. `generateBoard` retries it on a fresh internal seed like
any other declining stage, and reports `GenerationFailedError` only after
`DEFAULT_MAX_ATTEMPTS`.

## Consequences

- **A contour decline is visible rather than silently absorbed.** It shows up in
  `GenerateBoardDiagnostics.attemptFailures` instead of changing builder behind
  the caller's back. This is the point of the change, and it is also the risk:
  a mask the contour cannot tile now has no path builder at all. It is safe
  against the mask pipeline as ADR-0009 leaves it, and not safe against an
  arbitrary future mask. Multi-region silhouettes are the open change most
  likely to reintroduce one.
- **`bendProbability` steers every board.** There is no builder left that
  ignores it, so the achieved `bendRate` is a function of the request on every
  board rather than on most of them.
- **The segmenter loses a test input, knowingly.** Its property tests ran
  against both builders, and backbite's near-uniform random walks were the less
  structured of the two. They now run against contour only. Accepted rather than
  worked around: keeping a deleted production algorithm alive as a fixture keeps
  its defect alive with it, and the walks that matter are the ones the game
  ships.
- **Board output changed for every seed.** `attemptGenerate` no longer draws a
  backbite seed from the attempt's root rng, so the segmentation seed for a
  given `(seed, params)` differs from before. Determinism is unaffected — the
  same seed still restarts the same board — but a seed does not name the same
  board across this change.
- **Reversing this is a revert, not a rewrite.** The builder is one deleted file
  with its own tests, and the call site it hung off is four lines.
