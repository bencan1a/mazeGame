# Reference art

What a finished board should look like. Two hand-made boards, both real and
playable, and both at a density the generator has to be able to reach.

| File                    | What it is                                          |
| ----------------------- | --------------------------------------------------- |
| `example-board.jpg`     | Three lobes, short heavily bent segments, four hues |
| `example-board-cup.jpg` | Four stacked bands at a higher density              |

Read off these, the regime to aim for is short pieces — a mean of about five
cells with a spread of about three — over a densely bent path. That is what
`meanPieceLength` and `pieceLengthVariance` are dialled against; `bendRate` in
[METRICS.md](../METRICS.md) is the ground truth for the path's share of it.
