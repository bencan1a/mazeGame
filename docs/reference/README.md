# Reference art

What a finished board should look like. Two hand-made boards, both real and
playable, and both at a density the generator has to be able to reach.

| File                    | What it is                                          |
| ----------------------- | --------------------------------------------------- |
| `example-board.jpg`     | Three lobes, short heavily bent segments, four hues |
| `example-board-cup.jpg` | Four stacked bands at a higher density              |

Read off these, the regime to aim for is mostly short pieces with the odd long
snake, over a densely bent path. `DEFAULT_GEN_PARAMS` is dialled against that:
`meanPieceLength: 6` with `pieceLengthVariance: 8`, which lands segments across
2..35 cells rather than clustering them. `bendRate` in
[METRICS.md](../METRICS.md) is the ground truth for the path's share of the
look, and it is not steerable today — see issue #87.
