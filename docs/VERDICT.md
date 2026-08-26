# PoC verdict

Closes the PoC. Answers the three goals in [PRD §2](./PRD.md), records the
defaults the game ships with, and says what a v1 would have to settle that this
build did not.

**Verdict: build it.** Generation is correct and fast enough to stop worrying
about. The game is fun enough that the PM played it to a set of defaults rather
than to a list of complaints. The performance goal is the one that is _asserted_
rather than measured, and that is the honest headline of this document.

---

## Goal 1 — generation is correct and always solvable

**Met, with numbers.**

280 boards at the shipped defaults across seven grid sizes, zero failures, zero
retries, coverage exactly 1.0 on every board:

| gridSize | boards | failures | `generationMs` mean / max | segments | mean length | `bendRate` | `dagDepth` max | mean free set |
| -------- | ------ | -------- | ------------------------- | -------- | ----------- | ---------- | -------------- | ------------- |
| 20       | 40     | 0        | 2.3 / 9.9                 | 12.7     | 14.80       | 0.438      | 8              | 3.2           |
| 30       | 40     | 0        | 3.4 / 4.5                 | 29.2     | 14.39       | 0.413      | 12             | 5.1           |
| 40       | 40     | 0        | 7.0 / 9.2                 | 51.2     | 14.44       | 0.410      | 14             | 6.8           |
| 60       | 40     | 0        | 21.3 / 24.9               | 113.4    | 14.80       | 0.405      | 27             | 10.9          |
| **78**   | 40     | 0        | 45.1 / 52.5               | 191.3    | 14.79       | 0.403      | 29             | 13.5          |
| 90       | 40     | 0        | 68.9 / 80.5               | 257.7    | 14.63       | 0.404      | 31             | 16.5          |
| 100      | 40     | 0        | 91.5 / 105.1              | 316.8    | 14.65       | 0.402      | 34             | 18.0          |

Spec `sweeps/specs/shipped-defaults.json`, rows `sweeps/data/shipped-defaults.csv`,
reproducible with
`npm run harness -- --sweep docs/sweeps/specs/shipped-defaults.json`.

On top of that, at the shipped defaults, `generate.heavy.test.ts` validates
**6000 boards** — 1000 seeds at each of gridSize 20, 40 and 100, in both the
shipped wide piece-length distribution and a tight one — checking structure and
a full greedy clear on every one. Zero failed to generate and zero finished with
a stuck segment. It is opt-in rather than a CI gate because it takes minutes:
`RUN_HEAVY_GENERATE_SWEEP=1 npm test -- src/core/generate.heavy.test.ts`.

Solvability is not sampled — it is constructed. Cut placement and head choice
happen together and build an acyclic blocking digraph, so there is no orientation
search left to fail (this is what retired R2). Every PR runs the property tests
over that invariant.

**The one caveat worth carrying forward:** `minFreeSetSize` bottoms out at 1 on
boards at every size, meaning the clear order passes through forced moves. That
is a difficulty property, not a defect — but it means a player who cannot find
the single free segment is stuck rather than merely slowed.

## Goal 2 — the game is fun

**Answered by the PM on a phone, and not written down anywhere it can be
reproduced.**

The defaults below _are_ the finding: they were converged on by playing across
the parameter space with the tuning panel open, on the deployed build. Nothing
else about those sessions was recorded — `docs/playtest/` holds only its README.
So this section rests on the PM's judgement, which is the right authority for
G2, but it is judgement rather than a log.

What that costs, concretely, and it is worth knowing before anyone plans a v1:

- **No unpleasant board was recorded with its seed.** A board is a pure function
  of `(seed, params)`, so any bad board was reproducible for free, and none were
  kept.
- **No time-to-clear or lives-lost figures**, so nothing calibrates board length
  against attention span except the estimate below.
- **No recorded answer on whether pan-and-judge is tense or merely
  frustrating.** That was the question that decides whether the deferred
  ray-trace hint gets promoted (PRD §8), and it is unanswered — the hint stays
  deferred by default, not by evidence.

Two things the chosen defaults say on their own, both worth stating because they
contradict earlier measurements taken against the reference art:

- **Playtesting went the opposite way from the art on piece length.** #85
  measured the reference art at ≤5.25 cells per piece and suggested trying
  _shorter_ pieces than the then-default 6. The defaults landed on a request of
  11 cells, achieving ~14.8. Longer pieces, not shorter, by a factor of about
  three.
- **The default is a hair bendier than the art.** The art was matched at a
  `bendRate` band of 0.33–0.41; the shipped `bendProbability` of 0.75 achieves
  0.411 at gridSize 40 and 0.403 at 78. `generate.test.ts` pins it against that
  band with a small tolerance rather than inside it.

Neither is a problem. They mean the game that plays well is not the game that
looks most like the source art, and any future silhouette-matching work should
not assume the art's own statistics are the target.

## Goal 3 — performance at 100×100 on a phone

**Generation: met. Frame rate and memory: asserted, not measured.**

Generation at 100×100 is 92 ms mean, 105 ms max — comfortably inside the 1s
clause. That number is off this repo's cloud container, not a phone, so read it
as a bound on the algorithm rather than a device measurement; a phone doing this
4× slower still clears the goal by a factor of two.

Everything else in G3 is unmeasured. [#30](https://github.com/bencan1a/mazeGame/issues/30),
the device pass, was closed on the PM's judgement after playing a 100×100 board
via `?grid=100`: it ran acceptably. None of its criteria were recorded — no
frame rate, no peak memory, no on-device generation time, no device model or OS
version — and the buffer-cap degradation ladder was never exercised, because it
only engages on hardware that refuses the 8192² allocation.

So, plainly: **this document cannot state which grid sizes hold 60fps**, because
nothing measured a frame. What it can state is that one iPhone played a 100×100
board without the PM noticing a problem, and that everything the renderer's
memory design rests on — the per-canvas cap between 8192² and 10000², the
blank-not-throw failure mode, the 1–2 ms whole-board repaint — comes from a
single device in [#19](https://github.com/bencan1a/mazeGame/issues/19). **Android
is untested end to end.**

R3 stays retired on [ADR-0006](./adr/0006-grid-size-is-a-parameter.md)'s
reasoning rather than on measurement: grid size is a player-facing parameter, so
a size that performs badly is a setting to turn down, not a defect to ship.

**Board length, since it is the number a player feels.** Clear time is at least
`segmentCount × animationDurationMs`: about 1m50s of animation at the default
78×78, and about 3m0s at 100×100, before any thinking time. A 100×100 board is a
long sitting by design.

## Recommended defaults

Shipped in `DEFAULT_GEN_PARAMS` / `DEFAULT_PLAY_PARAMS`.

| Parameter             | Default | Was | Why                                                                             |
| --------------------- | ------- | --- | ------------------------------------------------------------------------------- |
| `gridSize`            | 78      | 40  | Dense enough that the ray is a real search; short enough to finish in a sitting |
| `meanPieceLength`     | 11      | 6   | Achieves ~14.8 cells; long pieces make rays worth tracing                       |
| `pieceLengthVariance` | 20      | 8   | Top of the panel's range — mixed lengths read as less mechanical                |
| `bendProbability`     | 0.75    | 0.6 | Achieves ~0.40, near the reachable ceiling of ~0.45                             |
| `minStraightRun`      | 2       | 2   | Unchanged                                                                       |
| `lives`               | 3       | 3   | Unchanged                                                                       |
| `animationDurationMs` | 570     | 420 | Slower exit; the snake-out is the game's only piece of feedback                 |

`seed` stays 1, so every fresh load plays the same board. That is fine for a PoC
and is the first thing a v1 has to replace.

Two of these are requests rather than settings, and the tuning panel says so
live: `bendProbability` is a steer inside a band the contour geometry bounds
(ceiling ~0.45, floor rising as the board shrinks), and `meanPieceLength` is the
sampler's mean, which the length floor pushes up by more as
`pieceLengthVariance` grows. At the shipped pair the gap is about +3.8 cells.

## Decisions this closes

**The tuning panel ships.** It was built as a dev panel and it stays in the
player build, behind the `Tune` button, with every generation and play parameter
live and the metrics readout with them. It is not gated on a build flag or a
query parameter. Docs that call it "the dev panel" are describing a shipped
feature.

**Parity absorption stays as insurance** ([#79](https://github.com/bencan1a/mazeGame/issues/79)).
It is unreachable from the current pipeline — every procedural mask is built
from whole 2×2 blocks and has an imbalance of exactly 0 — but the image-import
pipeline deferred in PRD §8 is exactly the non-block-aligned silhouette source
that would need it. The code stays; PRD §3.1's "as close to 100% as parity
allows" reads as 100% for procedural silhouettes today.

## What a v1 would need

1. **A board source.** One fixed seed is the PoC's biggest single gap as a
   product: levels, a daily board, or a shuffle, plus whatever progression sits
   on top.
2. **The G3 measurements, or an explicit ceiling.** Frame rate, peak memory and
   on-device generation time on at least one iPhone and one Android, or a
   recorded decision to cap the grid size instead.
3. **One recorded playtest answer on pan-and-judge**, which decides the
   ray-trace hint.
4. **Silhouettes that are shapes.** Procedural blobs were the right PoC input;
   the silhouette library and image-import pipeline (PRD §8) are what make the
   board a picture of something.
