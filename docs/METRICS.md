# Metrics

Difficulty in this game is **visual search**, not logic depth (PRD §1.1).
Removals only unblock, the blocking relation is a static DAG, and any greedy
order wins — so there is nothing combinatorial to be hard. What is hard is
tracing a 60-cell ray across a dense field and judging whether one thin segment
crosses it.

That means intuition about difficulty is unreliable, and the parameters get
dialled from measurements instead.

## What the harness reports

| Metric                              | Definition                                                   | Reads as                                          |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `dagDepth`                          | Longest chain in the blocking digraph                        | How far ahead the board forces you to work        |
| `meanFreeSetSize`                   | Mean number of clickable segments across a full greedy clear | How much there is to scan at any moment           |
| `minFreeSetSize`                    | Smallest free set seen during the clear                      | Bottleneck moments — a 1 here means a forced move |
| `coverage`                          | Covered cells / inside cells                                 | Generation quality; target ≥ 0.99                 |
| `bendRate`                          | Fraction of interior path cells that are corners             | Ground truth for `bendProbability` (R1)           |
| `segmentCount`, `meanSegmentLength` | Board composition                                            | Board length; sanity check on segmentation        |
| `edgeCount`                         | Blocking edges                                               | Memory pressure at large sizes                    |
| `generationMs`                      | Wall clock for `generateBoard`                               | PRD §2 goal 3: under 1s at 100×100                |

`dagDepth` and the free-set statistics both fall out of the topological sort
validation already runs. Compute them there; do not walk the graph twice.

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
