# Contracts

The interfaces every stream codes against. The authoritative version is
[`src/core/types.ts`](../src/core/types.ts) — this file explains the _reasoning_
the types cannot carry.

**These are shared files.** Changing `src/core/types.ts` or `test/fixtures/`
affects every agent at once, so it goes through the contract-change process in
[WORKFLOW.md](./WORKFLOW.md#changing-a-contract).

---

## Conventions that everything depends on

| Convention  | Value                             | Why                                                                   |
| ----------- | --------------------------------- | --------------------------------------------------------------------- |
| Cell index  | `y * width + x`                   | One number, no `{x, y}` allocation in any hot path                    |
| Segment ids | 1-based                           | `occupancy[i] === 0` means "empty cell", which needs id 0 free        |
| Directions  | `0=N(-y) 1=E(+x) 2=S(+y) 3=W(-x)` | `opposite(d) === (d + 2) & 3`                                         |
| Out-of-grid | `NO_CELL === -1`                  | Returned by `step()`; check it, never assume in-bounds                |
| Randomness  | `createRng(seed)` only            | Boards must be reproducible; `Math.random` is a lint error in `core/` |

`grid.ts` owns the index arithmetic. Do not re-derive it inline — `step()`
exists specifically because `index - 1` at `x === 0` silently wraps to the
previous row, which is a bug every grid codebase writes once.

---

## Stage contracts

### `GenParams -> Mask` (S1)

```ts
buildMask(params: GenParams): Mask
```

Postconditions the validator will check:

- `inside` has exactly one 4-connected component.
- No cell with `inside === 1` has fewer than 2 inside-neighbours (the
  morphological open is supposed to have removed 1-cell spurs; if this fails,
  a Hamiltonian path may not exist).
- `|black| − |white| ∈ {0, ±1}` over cells where `inside && !unvisited`.
- `unvisited` marks 1–3 cells at most, and every one has `inside === 1`.
- `pathCellCount` equals the count of `inside && !unvisited` cells.

`unvisited` is the parity-absorption mechanism. Marking a cell unvisited is
strictly preferred over editing the silhouette: it is visually invisible and it
makes the path feasible unconditionally.

### `Mask -> HamiltonianPath` (S2)

```ts
buildPath(mask: Mask, rng: Rng): HamiltonianPath
```

Postconditions:

- `cells.length === mask.pathCellCount`.
- Every entry is inside and not unvisited.
- No repeats — it is a path, not a walk.
- Consecutive entries are 4-neighbours (`directionBetween` !== -1).

The contour method returns a Hamiltonian _cycle_; cutting it anywhere yields the
path. Backbite is the fallback for regions that will not tile into 2×2 blocks.

### `HamiltonianPath -> segments` (S3)

```ts
segmentPath(path: HamiltonianPath, params: GenParams, rng: Rng): { segStart: Uint32Array; segCells: Uint32Array }
```

Postconditions:

- Segments partition the path exactly: concatenating them reproduces
  `path.cells` in order.
- No segment is empty.
- No cut leaves a straight run shorter than `params.minStraightRun`, except
  where the path itself has no such run available.
- Mean segment length is within tolerance of `params.meanPieceLength`.

### orientation (S3)

```ts
orientSegments(segments, occupancy, width, height, rng): { segHead: Uint32Array; segDir: Uint8Array; segReversed: Uint8Array }
```

The head is one of the segment's two endpoints; `segDir` is the direction of its
terminal stroke, i.e. the direction it exits in. So for a segment of two cells or
more, `segDir` is _derived_ rather than chosen — picking the head fixes it, and
the segment contributes one bit to orientation's search space.

**A one-cell segment is the exception**: it has no terminal stroke for that rule
to read, so nothing constrains its direction and all four are legal. An orienter
must offer all four as candidates for such a segment rather than two, and it
contributes two bits rather than one. `checkStructure` skips the terminal-stroke
check for these, which is what makes that sound.

**`segCells` runs tail → head, so the head must be the _last_ cell of the
segment's slice.** `checkStructure` enforces that. An orienter that picks the
other endpoint has not merely set `segHead` — it has reversed the segment, and
must say so: `segReversed[k] === 1` means segment k's cells are to be emitted in
reverse of the order the segmenter produced them. Whoever assembles the `Board`
applies the flag.

Returning a head without the flag produces a board `validateBoard` rejects at
the _structure_ gate, not the acyclicity one — the digraph is perfectly acyclic,
the polyline just runs the wrong way. That is a quiet failure mode, which is why
the flag is part of the contract rather than a convention.

The only hard postcondition is that the resulting blocking digraph is **acyclic**.
Everything else is a quality preference.

Two implementations, and both are in scope:

1. **Local search** — build graph, Tarjan SCC, flip a segment inside a
   non-trivial SCC, recheck. Time-boxed.
2. **Reverse construction** — implemented as a **peel over the full board**,
   not as insertion into an empty one. Repeatedly take any remaining segment
   whose exit ray is clear of the segments still present, fix that endpoint as
   its head, and remove it. The peel order is a valid removal order, so
   reversing it gives the PRD's insertion order and acyclicity is free by
   construction.

   The direction matters, and not only for exposition. Removals only ever
   unblock, which is what makes the peel safe. Insertion is the anti-monotone
   mirror — the placed set only grows, so a segment's ray only becomes more
   constrained — and a greedy insertion order is not in general the reverse of
   a valid removal order. Greedy insertion would need backtracking to match
   what the peel gets for free.

Reverse construction **trades away no packing density**. Segmentation is
upstream and fixed, so both implementations place identical cells in identical
positions; there is nothing for orientation to pack. What it trades is puzzle
quality — DAG depth and the free-set profile.

The peel is also **complete** over the candidate set: if any acyclic
orientation of a given segmentation exists, the peel finds one, whichever
eligible segment it happens to pick. Take any valid removal order and consider
its first segment not yet peeled — every segment blocking it comes earlier in
that order, so all of them are already gone and it is eligible now. The peel
therefore never strands. So a failure means no acyclic orientation of _those
cells_ exists, and the recovery is re-segmenting or re-pathing. Never retry
orientation with a different seed; there is nothing for a different seed to
find.

This completeness is a property of the peel direction specifically. It would
not survive a rewrite to greedy insertion.

Fallback from 1 to 2 must be automatic and must be recorded in
`BoardMetrics.orientationFallback`, because "how often do we fall back" is data
the tuning phase needs.

### blocking digraph (S3)

```ts
buildBlockingGraph(board-ish): { edgeStart: Uint32Array; edgeTarget: Uint32Array }
```

Walk the ray from `segHead[k]` in `segDir[k]` to the board edge, reading
`occupancy`. Each **distinct other** segment id encountered is a blocker; emit
edge `k -> blocker`. A segment's own cells are skipped — a segment never blocks
itself. De-duplicate: a long segment crossing the ray twice is one edge.

### coloring (S3)

```ts
colorSegments(adjacency, segmentCount): Uint8Array
```

Greedy over the adjacency graph (segments whose cells are 4-neighbours), 4–6
hues. **Adjacent segments must not share a hue.** This is how the player sees
where one segment ends and the next begins; it is a readability requirement, and
the test asserts the property, not merely that colors were assigned.

### validation (S4)

```ts
validateBoard(board: Board, mask: Mask): void  // throws BoardInvariantError
```

Checks, all of them, every time in dev and in tests:

- blocking digraph is acyclic (topological sort consumes all n segments)
- coverage ≥ 99% of inside cells; unvisited cells account for the remainder
- `occupancy` and the CSR segment lists agree in both directions
- every segment is reachable — a greedy clear removes all n
- determinism: regenerating from the same `(seed, params)` gives identical arrays

### metrics (S4)

```ts
computeMetrics(board: Board): BoardMetrics
```

DAG depth and mean free-set size both fall out of the topological sort that
validation already runs — compute them there rather than walking the graph
twice. See [METRICS.md](./METRICS.md).

### generateBoard (S4)

```ts
generateBoard(params: GenParams): Board
generateBoardWithDiagnostics(params: GenParams, options?: GenerateBoardOptions): GenerateBoardResult
```

The single public entry point: mask -> path -> segmentation -> orientation ->
validation -> colors, pure in `(seed, params)` per ADR-0004. `generateBoard` is
the exact `GenerateBoard` shape declared in `types.ts`; `generateBoardWithDiagnostics`
is the same pipeline with the retry count and per-attempt failure reasons
attached, for a caller (the tuning harness) that needs to see why a board took
more than one attempt.

**Validation runs by default.** `GenerateBoardOptions.validate` defaults to
`true` and there is no environment-based branching — an explicit `false` is
the only way to skip it. There is no meaningful performance case for skipping
it: `validateBoard` costs low single-digit milliseconds even on a board with
several hundred segments, negligible next to orientation's own cost.

**Retry.** A generation attempt can fail as data (`ok: false` from path
building) or as a typed throw (`MaskRepairError`, `BoardInvariantError`, or
the specific "local search did not converge, and reverse construction ...
There is no further fallback" throw `orientSegments` uses once every fallback
is exhausted). All three are retried: a new internal seed is derived
deterministically from `(params.seed, attempt)` — attempt 0 is the seed
itself unmodified — and the whole pipeline reruns from mask generation, up to
`GenerateBoardOptions.maxAttempts` (default 8, `DEFAULT_MAX_ATTEMPTS`).
Re-running the whole pipeline, not just orientation, matters for a stuck
orientation specifically: the peel is complete over its candidate set, so a
"stuck" result proves no acyclic orientation exists for that exact
segmentation, and only a new segmentation — which only a new seed produces —
can change the outcome.

Any other thrown error (a malformed segment, a corrupt CSR offset — upstream
corruption rather than a proven cycle) is deliberately **not** caught as
retryable and propagates immediately, so a real bug surfaces as itself rather
than as eight identical retries disguised as an unsolvable board.

**Exhaustion.** When every attempt fails, `generateBoard` throws
`GenerationFailedError` with every attempt's failure reason attached
(`detail.attemptFailures`). This is a real outcome at ordinary sizes today,
not only at pathological parameter combinations: most of the failure comes
from orientation finding no acyclic assignment for the segmentation a given
seed happens to produce, which is far more common at gridSize 40+ than the
mask-repair floor at very small gridSize with very low fillFraction. Retrying
further does not reliably help either failure mode, because every stage here
is deterministic in its seed.

### rendering (S5) and game (S6)

Both consume a finished `Board` and nothing else. Neither may reach into the
generator's intermediate stages, and neither may mutate `Board` — removal state
lives in the game layer as a separate removed-set, so that restarting a board
means dropping that set rather than regenerating.

---

## Fixtures

`test/fixtures/` provides synthetic inputs so no stream waits on another:

| Builder           | Produces                                                            | Used by        |
| ----------------- | ------------------------------------------------------------------- | -------------- |
| `makeMask(spec)`  | A `Mask` from an ASCII-art string or a rectangle                    | S2, S4         |
| `makePath(mask)`  | A trivially-correct boustrophedon path over a rectangle             | S3, S4         |
| `makeBoard(spec)` | A small hand-checkable `Board`, including a deliberately cyclic one | S3, S4, S5, S6 |

ASCII specs keep the failing case readable in a test report, which matters more
than it sounds when six agents are reading each other's test failures.
