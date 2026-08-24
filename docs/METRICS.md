# Metrics

Difficulty in this game is **visual search**, not logic depth (PRD §1.1).
Removals only unblock, the blocking relation is a static DAG, and any greedy
order wins — so there is nothing combinatorial to be hard. What is hard is
tracing a 60-cell ray across a dense field and judging whether one thin segment
crosses it.

That means intuition about difficulty is unreliable, and the parameters get
dialled from measurements instead.

## What the harness reports

| Metric                              | Definition                                                                               | Reads as                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `dagDepth`                          | Longest chain in the blocking digraph                                                    | How far ahead the board forces you to work                      |
| `meanFreeSetSize`                   | Mean number of clickable segments across a full greedy clear                             | How much there is to scan at any moment                         |
| `minFreeSetSize`                    | Smallest free set at a step where something was still blocked                            | Bottleneck moments — a 1 here means a forced move               |
| `shortOfTarget`, `belowMinimum`     | Pieces the cut-and-orient peel cut shorter than asked, and shorter than `minPieceLength` | How much board quality the peel is giving up                    |
| `coverage`                          | Covered cells / inside cells                                                             | Generation quality; target ≥ 0.99                               |
| `bendRate`                          | Fraction of interior path cells that are corners                                         | What `bendProbability` achieved, which is not what it requested |
| `segmentCount`, `meanSegmentLength` | Board composition                                                                        | Board length; sanity check on segmentation                      |
| `edgeCount`                         | Blocking edges                                                                           | Memory pressure at large sizes                                  |
| `generationMs`                      | Wall clock for `generateBoard`                                                           | PRD §2 goal 3: under 1s at 100×100                              |

`dagDepth` and the free-set statistics all fall out of one topological sort, so
`computeMetrics` runs Kahn's algorithm once and reads every one of them off that
result rather than walking the digraph per statistic.

That sort is not shared with `validateBoard`'s, which has already run on any
board that reached the harness: a `Board` carries no record of it, so a caller
that validates and then measures pays for two. Measured at 0.54ms on a
639-segment 100x100 board against generation's ~150ms, which is why the second
pass buys simplicity rather than costing anything worth plumbing around.

`shortOfTarget` and `belowMinimum` are not derivable from a finished `Board` —
they are what the peel _wanted_ versus what it got. They reach the harness on
`generateBoardWithDiagnostics(...).diagnostics.peel`.

**`minFreeSetSize` excludes the endgame, deliberately.** Defined as the smallest
free set seen at _any_ step, it is 1 on every board that has segments at all:
the last step leaves exactly one segment and it is necessarily free. Measured
across 400 boards at 40×40 and 100×100 it was 1.0 every single time — a metric
with no variance is not a metric. So it counts only steps where some segment was
still blocked. Running out of board is not a bottleneck. If a board never blocks
anything, there is no such step and the metric is the segment count.

The underlying signal is real once the endgame is out of the way: on the boards
measured, the free set first narrows to 1 around 70–82% of the way through a
clear.

## The counterintuitive one

**More free segments can be harder.** A large free set means more candidates to
scan and more rays to judge; a small one means the board is nearly telling you
what to click. So do not read `meanFreeSetSize` as "easier when higher" — it is
a scan-load number, and the difficulty curve over it is not monotonic.

## The parameter interaction to watch

`bendProbability` trades directly against ray length. A windy segment is
compact, so its head sits nearer the silhouette edge, so its ray is shorter, so
it frees up early. A straight segment spans further but exits along a clean
corridor.

**"More bends = harder" is not reliably true.** This is a joint distribution,
steered by the numbers, not by feel.

## Using the harness

```
npm run harness -- --seeds 200 --grid 40 --json out.json
npm run harness -- --sweep sweeps/bendiness.json
```

Parameters in, metrics out, no rendering. A board takes a fraction of a second,
so sweeping thousands is routine. Two things the sweep must answer before the
renderer is worth investing in:

1. **Does the parameter space have range at all?** If every setting produces the
   same `dagDepth` and free-set profile, there is no difficulty curve to tune
   and the design needs rethinking.
2. **Does generation hold at 100×100?** `generationMs` under 1s is PoC goal 3's
   first clause, and it is the only part of that goal the harness can settle.

Two things the harness explicitly **cannot** tell you:

- **Whether the game is fun.** Only playing does that, which is why the renderer
  and game loop are core PoC scope rather than follow-on work.
- **Whether the app performs.** Frame rate and buffer memory need a canvas on a
  real device. R3 is a performance risk, not a playability one
  ([ADR-0006](./adr/0006-grid-size-is-a-parameter.md)) — grid size is a
  parameter the player can turn down — so do not read a clean sweep as evidence
  that 100×100 works. It only means the board can be _built_ in time.

`segmentCount` × animation duration is still worth reporting as a clear-time
estimate. It is a fact about a board at a given size, not a verdict on it.
