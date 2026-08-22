# Fixtures

Synthetic masks, paths, and boards. **This is the mechanism that lets the
streams run in parallel** — every stage is developed against a synthetic version
of its own input instead of waiting for the stage upstream of it.

| Builder                  | Produces                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| `makeMask(spec)`         | A `Mask` from ASCII art (`#` inside, `.` outside, `o` unvisited) or a rectangle |
| `makePath(mask)`         | A boustrophedon Hamiltonian path over a rectangle                               |
| `makeBoard(spec)`        | A hand-checkable `Board` from a picture                                         |
| `makeBoardAndMask(spec)` | The same board plus the `Mask` it covers, from one source                       |

ASCII specs on purpose: when six agents are reading each other's test failures,
a readable failing case is worth more than a compact one.

## Board pictures

Lowercase letters are segment bodies, the uppercase letter is that segment's
head, `.` is outside, `o` is inside but unvisited. `o` is reserved, so no
segment can be called `o`.

```
aaaa    a runs along the top and turns down the right edge; exits south into c
bbBA    b turns up out of the middle; exits east into a
bbcc    c wraps the bottom; exits west off the board, so it is the only free one
Cccc
```

Segment ids are assigned by first appearance in a row-major scan. Everything
else is derived, because the contract forces it: `segCells` runs tail → head,
`segDir` is the terminal stroke, and the blocking edges are whatever the exit
ray hits.

One thing the picture genuinely cannot say. When a segment has a **chord** — two
of its cells adjacent in the grid but not consecutive in the walk — its cell set
admits more than one ordering, and the ordering is what the renderer draws. Any
segment cut from a space-filling path that doubles back beside itself has one,
so this is the ordinary case, not an exotic one. Spell the walk out from the
tail when it happens:

```ts
makeBoard({ art: ACYCLIC_BOARD_ART, walks: { b: 'WNEE', c: 'ESWWW' } });
```

`makeBoard` throws and names the cell rather than picking a walk for you.

## Ready-made boards

| Fixture             | Blocking digraph        |
| ------------------- | ----------------------- |
| `ACYCLIC_BOARD`     | DAG; clears `3, 1, 2`   |
| `TWO_CYCLE_BOARD`   | `1 ⇄ 2`; a clear stalls |
| `THREE_CYCLE_BOARD` | `1 → 2 → 3 → 1`         |

The cyclic ones are structurally sound in every other respect — same CSR, head,
direction and colour invariants as a real board. A malformed fixture would let a
validator reject them for the wrong reason and still look correct.

## Checkers

`postconditions.ts` has the contracts from [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md)
as functions returning a list of violations: `maskViolations`, `pathViolations`,
`boardStructureViolations`, `boardMaskViolations`, plus `greedyClearOrder` and
`isAcyclic`. They return rather than throw, so a deliberately-broken fixture can
be checked for exactly the breakage it is meant to have.

These are not `validateBoard` (S4, `src/core/validate`) — that one throws, runs
in dev, and computes metrics on the way through. When it lands it should be
tested **against these fixtures**, not against this file.

## Building things the builders refuse to build

The builders are not validators: they build what the spec says, including specs
that violate a contract, because the validator's failing cases have to come from
somewhere. Where a builder does refuse, it is because the spec is ambiguous
rather than wrong, and there is a way to say what you meant:

- `makePath` covers full rectangles only. Supply your own walk with
  `makePathFromCells(mask, cells)` — it checks the S2 postconditions but will
  not invent a path, because a general Hamiltonian path over an arbitrary mask
  is S2's own work (#5, #6) and a fixture copy of it would be wrong in the same
  places as the thing under test.
- `makeBoard` takes an `edges` override to build a board whose CSR deliberately
  disagrees with its geometry.

Fixtures are a **shared file**. Changes follow the contract-change process in
[`docs/WORKFLOW.md`](../../docs/WORKFLOW.md#changing-a-contract).
