# Sweep report — does the parameter space have usable range?

Gate for milestone M2. Closes #17.

Machine: this repo's dev container, run via `npm run harness`. It is a shared
cloud runner, not a phone — see [`TESTING.md`](../TESTING.md). Every
`generationMs` figure below is wall clock on that machine and should be read
as a trend, not a device number.

905 boards, 5 sweeps, **zero generation failures**, coverage exactly 1.0 on
every board, and zero retries (`attempts` is 1 everywhere). The peel's
whole-run fallback fired exactly once in 905 boards, at `minPieceLength: 6`,
seed 9 — the only board in the set where the length floor cost anything at
all. Specs are in
[`specs/`](specs/), raw per-board rows and per-cell aggregates in
[`data/`](data/) — `npm run harness -- --sweep docs/sweeps/specs/<file>.json
--csv docs/sweeps/data/<file>.csv` reproduces each one from a fresh checkout.

## Headline

**Yes, the space has usable range — through three of the four swept
parameters.** `gridSize` and `meanPieceLength` move `dagDepth`,
`meanFreeSetSize` and `segmentCount` by a large factor over their tested
ranges. `pieceLengthVariance` is the weakest of the three and its effect
depends on where `meanPieceLength` sits: at a mean of 4 it is a real lever,
at a mean of 20 it barely moves `segmentCount` (38.8 to 36.6 across variance
2 to 16) and nudges `meanFreeSetSize` the opposite way from what more spread
would suggest. Tables below. **`bendProbability` does not move
anything.** Every metric — `bendRate`, `segmentCount`, `dagDepth`,
`meanFreeSetSize`, `edgeCount` — is identical to at least four decimal places
across `bendProbability` 0.1 through 0.9. Only `generationMs` differs, and
that's run-to-run runner noise. **That result is superseded**: the commit this
sweep ran against predates the change that made the parameter steer the
spanning tree, so the figures below record the generator before it, not the one
in `main`. Re-measuring that axis is the first thing a follow-up sweep should
do.

## Does generation hold under 1s at 100×100?

Yes, with a wide margin, at every `meanPieceLength` tested.

| gridSize | segments (mean) | generationMs mean / max | headroom to 1s |
| -------- | --------------- | ----------------------- | -------------- |
| 20       | 23.0            | 2.7 / 11.8              | ~85×           |
| 30       | 53.9            | 4.8 / 6.3               | ~159×          |
| 40       | 96.8            | 12.2 / 18.1             | ~55×           |
| 60       | 219.3           | 34.5 / 40.8             | ~25×           |
| 80       | 388.3           | 80.7 / 101.9            | ~10×           |
| 100      | 607.3           | 153.2 / 214.4           | ~5×            |

30 seeds/cell, `DEFAULT_GEN_PARAMS` otherwise (`meanPieceLength: 6,
pieceLengthVariance: 8`). Worst observed single board at 100×100 was 214ms.
Cross-checked against a `meanPieceLength` sweep at 100×100 (denser boards cost
more): the densest cell tested, `meanPieceLength: 4` at grid 100 (728.9
segments, 6289 edges), still peaked at 194.8ms.

**What this settles and nothing more:** the board can be _built_ in under a
second on this machine at every size and density tested, which is PRD §2 goal
3's first clause. It says nothing about frame rate, pan/zoom, or buffer memory
on a phone — those need a canvas on real hardware (ADR-0006, `TESTING.md`
D1–D3) and are explicitly out of a headless harness's reach.

## Clear-time estimates (a fact, not a verdict)

`segmentCount × DEFAULT_PLAY_PARAMS.animationDurationMs` (420ms), read off the
same table:

| gridSize | segments (mean) | estimated clear time |
| -------- | --------------- | -------------------- |
| 20       | 23.0            | 9.7s                 |
| 30       | 53.9            | 22.6s                |
| 40       | 96.8            | 40.7s                |
| 60       | 219.3           | 92.1s (~1.5 min)     |
| 80       | 388.3           | 163.1s (~2.7 min)    |
| 100      | 607.3           | 255.1s (~4.3 min)    |

This is animation time only — clicking, panning and misses (which replay the
bounce animation and cost time without progress) are not in it, so it is a
floor, not a prediction of session length. Whether a 4-minute floor at 100×100
is the right length for a session is a playtesting question (PoC goal 2), not
one this harness answers.

## Difficulty profile by region

### `meanPieceLength` × `pieceLengthVariance` (gridSize 40)

The achieved mean segment length (`meanSegmentLength`) is reported alongside
the nominal `meanPieceLength` because they diverge: `minPieceLength` truncates
the sampled distribution's left tail, so the achieved figure runs above the
nominal one, and increasingly so as `pieceLengthVariance` widens the
distribution being truncated. Read the achieved column, not the input, for
what a board actually looks like.

| meanPieceLength | pieceLengthVariance | achieved meanSegLen | segments | dagDepth (mean) | meanFreeSetSize | shortOfTarget (mean) |
| --------------- | ------------------- | ------------------- | -------- | --------------- | --------------- | -------------------- |
| 3               | 2                   | 3.35                | 217.3    | 22.5            | 16.0            | 7.33                 |
| 3               | 4                   | 4.18                | 174.7    | 21.8            | 13.0            | 5.08                 |
| 3               | 8                   | 5.77                | 127.4    | 16.4            | 11.3            | 4.00                 |
| 3               | 12                  | 7.07                | 103.8    | 15.6            | 10.1            | 3.75                 |
| 3               | 16                  | 9.26                | 80.2     | 12.2            | 8.7             | 4.50                 |
| 4               | 2                   | 4.19                | 173.7    | 21.7            | 12.7            | 8.67                 |
| 4               | 4                   | 4.82                | 151.1    | 17.6            | 12.9            | 5.58                 |
| 4               | 8                   | 6.18                | 118.3    | 16.3            | 10.8            | 5.08                 |
| 4               | 12                  | 7.69                | 96.3     | 13.7            | 9.7             | 4.58                 |
| 4               | 16                  | 9.28                | 79.3     | 12.9            | 8.8             | 3.75                 |
| 6               | 2                   | 5.91                | 123.3    | 15.9            | 10.9            | 8.17                 |
| 6               | 4                   | 6.44                | 113.2    | 17.7            | 10.1            | 7.08                 |
| **6**           | **8**               | **7.78**            | **93.9** | **12.7**        | **10.1**        | **5.33**             |
| 6               | 12                  | 9.02                | 81.0     | 13.4            | 8.6             | 4.00                 |
| 6               | 16                  | 10.33               | 70.9     | 12.4            | 8.3             | 4.92                 |
| 8               | 2                   | 7.86                | 92.6     | 15.3            | 9.4             | 9.58                 |
| 8               | 4                   | 8.21                | 88.8     | 14.4            | 8.9             | 7.50                 |
| 8               | 8                   | 8.88                | 82.7     | 13.9            | 8.3             | 6.17                 |
| 8               | 12                  | 10.33               | 71.4     | 11.4            | 8.2             | 4.83                 |
| 8               | 16                  | 11.00               | 66.7     | 12.3            | 8.0             | 5.83                 |
| 10              | 2                   | 9.84                | 73.9     | 12.9            | 7.7             | 8.92                 |
| 10              | 4                   | 9.89                | 73.7     | 13.2            | 8.0             | 6.58                 |
| 10              | 8                   | 10.59               | 69.6     | 12.8            | 7.7             | 5.75                 |
| 10              | 12                  | 11.58               | 63.5     | 12.3            | 7.0             | 4.92                 |
| 10              | 16                  | 12.22               | 60.0     | 10.5            | 7.5             | 6.00                 |
| 14              | 2                   | 13.43               | 54.2     | 11.0            | 6.7             | 7.83                 |
| 14              | 4                   | 13.79               | 52.8     | 11.3            | 6.2             | 6.42                 |
| 14              | 8                   | 13.96               | 52.2     | 9.9             | 7.0             | 4.67                 |
| 14              | 12                  | 14.00               | 52.2     | 10.4            | 6.8             | 5.83                 |
| 14              | 16                  | 14.97               | 49.2     | 10.3            | 6.5             | 6.25                 |
| 20              | 2                   | 18.76               | 38.8     | 9.5             | 5.4             | 8.42                 |
| 20              | 4                   | 19.11               | 38.1     | 9.3             | 5.3             | 5.33                 |
| 20              | 8                   | 18.49               | 39.4     | 9.0             | 5.5             | 6.75                 |
| 20              | 12                  | 18.95               | 38.8     | 7.8             | 6.3             | 5.58                 |
| 20              | 16                  | 20.16               | 36.6     | 8.6             | 5.7             | 4.25                 |

(12 seeds/cell, `belowMinimum` is 0 everywhere in this grid — the length floor
never binds at `minPieceLength: 2` over this range.) `dagDepth` runs 7.8–22.5
and `meanFreeSetSize` runs 5.3–16.0 across the grid: real, usable range. Short mean piece length with low variance is the clutter-and-depth
corner (dense, deep blocking chains); long mean piece length is the sparse,
shallow corner regardless of variance. `DEFAULT_GEN_PARAMS` (bolded row) sits
centrally, not at either extreme.

### `gridSize` scaling (`meanPieceLength: 6`, `pieceLengthVariance: 8`)

| gridSize | dagDepth (mean/max) | meanFreeSetSize | minFreeSetSize (mean) |
| -------- | ------------------- | --------------- | --------------------- |
| 20       | 6.4 / 10            | 4.6             | 1.47                  |
| 30       | 10.7 / 17           | 6.8             | 1.20                  |
| 40       | 14.0 / 20           | 9.8             | 1.30                  |
| 60       | 24.4 / 33           | 13.8            | 1.37                  |
| 80       | 34.0 / 50           | 18.4            | 1.30                  |
| 100      | 42.2 / 55           | 22.8            | 1.33                  |

Difficulty by these two metrics scales with grid size at fixed piece-length
parameters, roughly linearly for `dagDepth` and sub-linearly for
`meanFreeSetSize`. Cross-checked against `meanPieceLength` at grid 100 too
(`grid-piece-cross.json`): the mean-piece-length half of the relationship
holds at 100×100 as at 40×40, so that knob is not grid-size-specific. **That
sweep holds `pieceLengthVariance` at 8 in every cell**, so nothing here says
whether the variance half carries across grid sizes — see
`data/grid-piece-cross.agg.csv` for what was actually run.

### `minPieceLength` floor (gridSize 40, `meanPieceLength: 6`, `pieceLengthVariance: 8`)

Not one of the four AC axes, but one of the three fields #88 changed by hand,
so swept here too.

| minPieceLength | segments | achieved meanSegLen | dagDepth | belowMinimum (mean) | shortStraightRuns (mean) |
| -------------- | -------- | ------------------- | -------- | ------------------- | ------------------------ |
| 1              | 101.2    | 7.29                | 14.5     | 0.00                | 0.00                     |
| **2**          | **95.5** | **7.69**            | **13.4** | **0.00**            | **0.05**                 |
| 3              | 90.8     | 8.09                | 15.2     | 0.00                | 0.05                     |
| 4              | 88.5     | 8.31                | 14.6     | 0.00                | 0.20                     |
| 6              | 79.1     | 9.27                | 13.8     | 0.00                | 0.50                     |

`belowMinimum` stays at 0 across the whole tested range — the peel holds the
floor without giving it up at every value tried here, which stops at
`minPieceLength: 6`. It does not hold indefinitely: the generator's own tests
pin under-length pieces appearing at a floor of 8, so the last untested step
is where this starts to cost something. `shortStraightRuns` (a
different quality cost — a cut left a straight run under `minStraightRun`)
climbs as the floor rises, from 0 at `minPieceLength: 1` to a mean of 0.5 per
board at 6. The current default of 2 sits on the cheap side of that climb.

### `bendProbability` (gridSize 40, `meanPieceLength: 6`, `pieceLengthVariance: 8`)

| bendProbability | achieved bendRate | segments | dagDepth | meanFreeSetSize | edgeCount |
| --------------- | ----------------- | -------- | -------- | --------------- | --------- |
| 0.1             | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |
| 0.2             | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |
| 0.3             | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |
| 0.35            | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |
| 0.5             | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |
| 0.7             | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |
| 0.9             | 0.3717            | 95.6     | 13.0     | 10.1            | 290.9     |

Every column but `generationMs` is byte-identical across the full 0.1–0.9
range, 15 seeds per cell. This is not "a small effect" — it is no effect: at
the commit measured, `buildContourPath` never read the parameter.

**These rows no longer describe `main`.** The parameter now biases the spanning
tree toward turning, and achieved bend rate tracks it monotonically over a band
whose ceiling sits near 0.48 at any board size and whose floor rises as the
board shrinks — roughly 0.06 at gridSize 100 against 0.26 at 20, because a
small region's own boundary forces corners. The default also moved from 0.35 to
0.6, the value that reproduces the bend rate these rows measured. The rest of this report still
stands statistically but not board for board: every other sweep held
`bendProbability` at its then-default, where it did nothing, and the new
default of 0.6 was picked to reproduce that same bend rate — so the
distributions carry over while the individual boards behind them do not, since
the same seed now draws differently.

## Do the current defaults hold up? (#88, and the question #85 asks)

`DEFAULT_GEN_PARAMS` after #88: `gridSize: 40, meanPieceLength: 6,
pieceLengthVariance: 8, minPieceLength: 2, bendProbability: 0.35,
minStraightRun: 2, fillFraction: 0.45`, chosen by eye against
`docs/reference/`.

Against this sweep, at gridSize 40 that cell measures: 93.9 segments
(mean), achieved segment length 7.78 (target was 6 — the floor-truncation
effect described above), `dagDepth` 12.7, `meanFreeSetSize` 10.1,
`shortOfTarget` 5.33 (~5.7% of segments cut short of what the peel asked
for), `belowMinimum` 0. Read against the fuller grid above: **the defaults
sit in the middle of the measured range on every axis, not at an extreme.**
Denser/shorter-piece cells reach `dagDepth` up to 22.5 and `meanFreeSetSize`
up to 16.0; sparser/longer-piece cells go as low as `dagDepth` 7.8 and
`meanFreeSetSize` 5.3. The peel gives up nothing measurable at this setting
(`belowMinimum: 0`), and the achieved segment-length mean of 7.78 matches the
7.49 measured on the same defaults when they were chosen.

That is agreement between two runs of the same generator, **not** agreement
with the reference art. Nobody has extracted a length distribution from the
boards in `docs/reference/` — they were matched by eye. Until someone does,
"the defaults look like the art" rests on judgement, and this sweep cannot
promote it.

**Verdict: this sweep supports the #88 choice** as a non-extreme, reasonable
starting point — it does not contradict it, and it does not sharpen it to a
single "best" cell, because "best" is a playtesting question this data
cannot answer (more free segments is not reliably easier — see
`METRICS.md`'s counterintuitive-metric note). This is a generator-internal
check: it says the defaults are unremarkable against the space the generator
can produce, and nothing about whether they resemble the reference art, which
no measurement here touches.

## Recommended defaults for first playtest

Keep `DEFAULT_GEN_PARAMS` as shipped by #88 (`meanPieceLength: 6,
pieceLengthVariance: 8, minPieceLength: 2`) — the data does not argue for
moving it. For **grid size**, start playtesting at 20–40: clear-time
estimates of 10–40s are a session-shaped floor to explore the difficulty
curve quickly. Treat 60–100 as later passes once the small end is tuned —
100×100 carries an estimated ~4.3-minute clear-time floor at these defaults,
which is a real session-length question for a human, not something this
sweep can settle. **Do not touch `bendProbability` as a difficulty lever** —
it has no measured effect; leave it at its current value until #7 resolves.

## What this report does not, and cannot, claim

- **Whether the game is fun.** PoC goal 2 needs a person playing, on the
  settings panel this data feeds — not a metrics table.
- **Frame rate, pan/zoom smoothness, or buffer memory at any grid size,
  including 100×100.** Those need a canvas on real hardware (ADR-0006;
  `TESTING.md` D1–D3). A clean generation-time sweep at 100×100 means the
  board can be built in time — nothing about whether it renders or holds
  memory on a phone.
- **A device-accurate generation time.** Every `generationMs` figure above is
  wall clock on a shared cloud runner. Useful for relative comparisons across
  parameters; not a number to quote for "generation takes N ms on a phone."
- **Difficulty as experienced.** `dagDepth` and `meanFreeSetSize` are proxies
  the harness can compute; they are not validated against how hard a board
  plays, which is what the counterintuitive-metric note in `METRICS.md`
  warns against reading into `meanFreeSetSize` directly.

## What I'm unsure about / left undone

- **Nothing here compares the boards to `docs/reference/`.** The defaults were
  matched to the art by eye; extracting a length distribution from the art
  itself is unmeasured and is the open half of the defaults question.
- The harness reports board-level `meanSegmentLength`, not a per-segment
  length distribution, so I could not directly confirm the #88 commit's claim
  of segments spanning "2..35 cells" at the shipped defaults — only that the
  achieved _mean_ (7.78) is close to its reported 7.5.
- Only five sweeps were run, chosen to cover the four AC axes plus
  `minPieceLength`; `minStraightRun` and `fillFraction` were held at their
  defaults throughout and are unexplored by this report.
