# Playtest log

One file per session: `YYYY-MM-DD-<n>.md`.

The metrics harness cannot tell anyone whether the game is fun. Only playing
does, which is why this directory is part of the PoC deliverable rather than
an afterthought.

Record per session:

- parameters and the board seed (a board is a pure function of these, so any
  session is reproducible exactly)
- time to clear, lives lost, whether it was finished at all
- **whether pan-and-judge felt tense or merely frustrating** — this is the
  finding that decides whether the deferred ray-trace hint (PRD §8) gets
  promoted
- whether the tap radius ever caused a bounce the player did not intend
- any board that was unpleasant, with its seed, so it can be re-examined

Negative findings are the valuable ones. Write them down plainly.
