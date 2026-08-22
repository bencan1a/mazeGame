# Fixtures

Synthetic masks, paths, and boards. **This is the mechanism that lets the
streams run in parallel** — every stage is developed against a synthetic version
of its own input instead of waiting for the stage upstream of it.

Builders to land here (see the `fixtures` issue in `docs/backlog.md`):

| Builder           | Produces                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| `makeMask(spec)`  | A `Mask` from ASCII art (`#` inside, `.` outside, `o` unvisited) or a rectangle |
| `makePath(mask)`  | A trivially-correct boustrophedon Hamiltonian path over a rectangle             |
| `makeBoard(spec)` | A small hand-checkable `Board`, including a deliberately cyclic one             |

ASCII specs on purpose: when six agents are reading each other's test failures,
a readable failing case is worth more than a compact one.

Fixtures are a **shared file**. Changes follow the contract-change process in
[`docs/WORKFLOW.md`](../../docs/WORKFLOW.md#changing-a-contract).
