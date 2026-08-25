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

**A silhouette is several lobes, not one mass.** Both reference boards are
disjoint regions — the cup is four stacked bands plus a plume of steam. A
Hamiltonian path cannot jump a gap, so a multi-region mask is several
independent fill problems sharing one grid, and every postcondition that
assumed one connected mass is stated over a region instead.

`regionOf` carries that: a 1-based region id per cell, 0 wherever the cell has
no path — outside the silhouette, or inside it and unvisited. `regionCount`
is how many there are.

Postconditions the validator will check:

- Each region is separately 4-connected: `regionOf` labels exactly the path
  cells (`inside && !unvisited`), and each label is one 4-connected piece.
- No cell with `inside === 1` has fewer than 2 inside-neighbours (the
  morphological open is supposed to have removed 1-cell spurs; if this fails,
  a Hamiltonian path may not exist).
- `|black| − |white| ∈ {0, ±1}` **per region**, over that region's path cells.
  Each region is its own path, so a board-wide balance says nothing.
- `unvisited` marks at most 3 cells per region, and every one has
  `inside === 1`.
- `pathCellCount` equals the count of `inside && !unvisited` cells, and the
  region sizes sum to it.

`unvisited` is the parity-absorption mechanism. Marking a cell unvisited is
strictly preferred over editing the silhouette: it is visually invisible and it
makes the path feasible unconditionally.

**Lobes too small to hold a path are dropped.** `RepairOptions.minRegionCells`
is that floor, in full-resolution cells, and it defaults to 4 — one 2x2 block,
the smallest lobe with no cell of degree below 2. Repair moves whole 2x2
blocks, so the effective floor is the setting rounded up to a multiple of 4.
The morphological open already erases anything near the default, so this is a
floor rather than a tuning dial; raise it to trim lobes that survive the open
but read as speckle.

### `Mask -> HamiltonianPath` (S2)

```ts
buildRegionPaths(mask: Mask, contourRng: Rng, backbiteRng: Rng, turnBias?: number): RegionPathsResult
```

**One path per region, concatenated.** `HamiltonianPath.regionStart` is CSR
over `cells`: region `r` walks `cells[regionStart[r - 1] .. regionStart[r])`.
Anything walking the path has to stop at those boundaries — the pair
straddling one is not a step.

Postconditions:

- `cells.length === mask.pathCellCount`, and `regionStart` has
  `mask.regionCount + 1` entries, starting at 0 and ending at `cells.length`.
- Every entry is inside, not unvisited, and in the region whose slice it sits
  in.
- No repeats — it is a path, not a walk.
- Consecutive entries **within a region** are 4-neighbours
  (`directionBetween` !== -1).

`buildContourPath` and `buildBackbitePath` each fill a single region and are
what `buildRegionPaths` calls per region; handed a multi-region mask they
report `ok: false` rather than filling one lobe and calling it done. The
contour method returns a Hamiltonian _cycle_; cutting it anywhere yields the
path. Backbite is the fallback, chosen per region, for lobes that will not tile
into 2×2 blocks. A lobe neither method can fill fails the stage — a board
missing a lobe is not the silhouette that was asked for.

### `HamiltonianPath -> segments + heads` (S3)

```ts
peelSegments(path: HamiltonianPath, params: GenParams, rng: Rng, width: number, height: number): PeeledSegments
```

**Cutting and orienting are one stage.** They were two, in that order, because
[PRD.md](./PRD.md) §4.2 wrote the pipeline as a linear sequence — and cut
placement blind to the blocking digraph does not work: above roughly 20×20 the
segmentations it produces admit **no** acyclic orientation at all, so no
orienter, however complete, could have rescued them. Issue #83 has the
measurements.

The stage is a peel. Keep the set of not-yet-committed path cells; repeatedly
commit one piece — a contiguous run of still-free path positions, with a head
at one of its two ends — accepting it only when the ray from that head to the
board edge crosses no cell that is still free. Committing removes those cells.

Postconditions:

- Segments partition the path exactly: undoing `segReversed` and concatenating
  reproduces `path.cells` in order.
- No segment is empty.
- **No segment spans two regions.** A multi-region path is peeled as one
  sequence rather than one region at a time, because the ray test is
  board-wide: a ray crossing another lobe's cells finds them, and those are
  exactly the blockers a per-region peel would miss and a cycle would close
  around.
- **The blocking digraph is acyclic**, and `peelOrder` is a witness: every
  segment a ray crosses was committed strictly earlier. This holds by
  construction — there is no search, and no way for the stage to fail.
- The head is the segment's **last** cell in `segCells`; `segReversed[k] === 1`
  where that required emitting the slice against path order.
- `segDir` is the direction of the terminal stroke for a segment of two cells
  or more. **A one-cell segment is the exception**: it has no terminal stroke,
  so all four directions are legal for it. `checkStructure` skips the
  terminal-stroke check for these, which is what makes that sound — and the
  one-cell piece is also what makes the peel unable to stall, since the topmost
  free cell always has a clear northward ray.
- Mean segment length tracks `params.meanPieceLength`, with
  `params.pieceLengthVariance` as the spread; cuts avoid leaving a straight run
  shorter than `params.minStraightRun` where the path offers an alternative.
- No segment is shorter than `params.minPieceLength` — at the default 2, no
  segment is a lone arrowhead with no body. A piece is only cut when what it
  leaves behind is itself long enough to be a legal piece, so the floor is
  maintained rather than checked afterwards.

**The floor is a target, not a postcondition, and `PeelStats.belowMinimum` is
how a caller tells.** Writing the corner cell's run as `[lo, hi]` and the cell's
position as `p`, the two moves that leave nothing behind are `[lo, p]` and
`[p, hi]`, so both fall short only when the run holds fewer than
`2 * minPieceLength - 1` cells with `p` away from both ends. At the default
floor of 2 that is a three-cell run with the corner in the middle, plus a
one-cell run where neither move exists at all; at larger floors it is a
widening family. `wholeRunEscape` covers what it can by committing a whole run
against an exactly-checked ray; where even that fails the peel relaxes rather
than failing. Measured over 40 boards at gridSize 40:

| `minPieceLength` | 2   | 3   | 4   | 6   | 8   |
| ---------------- | --- | --- | --- | --- | --- |
| pieces below it  | 0   | 0   | 0   | 2   | 12  |

Zero at the shipped default across 171,233 segments, and the heavy sweep
asserts it per board across 6000 more. Do not assume it above 3.

The achieved mean is not `meanPieceLength` either, for the same reason: the
floor truncates the distribution's left tail, so at the shipped spread
requesting 6 lands around 7.5 while requesting 14 lands on 14.

Everything after the acyclicity postcondition is a preference, and that is the
trade this design makes: the failure mode moves from "no board" to "an uglier
board". `PeelStats` reports the pressure — `shortOfTarget`, `belowMinimum`,
`wholeRunEscapes`, `shortStraightRuns` — so a sweep can see it rather than
infer it.

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

- blocking digraph is acyclic (topological sort consumes all n segments) —
  board-wide, since rays cross the gaps between lobes
- coverage ≥ 99% of inside cells; unvisited cells account for the remainder
- coverage per region: every path cell of every region is covered, so a board
  that drops a whole lobe fails naming the lobe rather than passing on a
  percentage the other lobes carry
- `occupancy` and the CSR segment lists agree in both directions
- every segment is reachable — a greedy clear removes all n
- determinism: regenerating from the same `(seed, params)` gives identical arrays

### metrics (S4)

```ts
computeMetrics(board: Board, context: MetricsContext): BoardMetrics
```

`MetricsContext` is `{ mask, path, generationMs }` — three things a finished
`Board` cannot answer for. `coverage` is covered cells over _inside_ cells, and
only `Mask` records which cells are inside. `bendRate` counts corners along the
walk, region by region; a `Board` records each segment's own run but not where
the walk continued between them, so measuring it per segment drops every cell
at a cut and drifts with `meanPieceLength` on an identical path. The two cells
either side of a region boundary end two separate walks rather than turning. `generationMs` is wall clock, which
`src/core/` may not read (ADR-0004). `generateBoardWithDiagnostics` carries the
mask and the path out on its result so a caller has all three without replaying
a stage.

The free-set statistics and DAG depth come from one greedy clear rather than one
walk per statistic. That clear is `computeMetrics`'s own: a `Board` carries no
record of the topological sort `validateBoard` already ran, so a caller that
validates and then measures pays for two. See [METRICS.md](./METRICS.md).

### generateBoard (S4)

```ts
generateBoard(params: GenParams): Board
generateBoardWithDiagnostics(params: GenParams, options?: GenerateBoardOptions): GenerateBoardResult
```

The single public entry point: mask -> path -> cut-and-orient -> validation ->
colors, pure in `(seed, params)` per ADR-0004. `generateBoard` is
the exact `GenerateBoard` shape declared in `types.ts`; `generateBoardWithDiagnostics`
is the same pipeline with the retry count and per-attempt failure reasons
attached, for a caller (the tuning harness) that needs to see why a board took
more than one attempt.

**Validation runs by default.** `GenerateBoardOptions.validate` defaults to
`true` and there is no environment-based branching — an explicit `false` is
the only way to skip it. There is no meaningful performance case for skipping
it: `validateBoard` costs low single-digit milliseconds even on a board with
several hundred segments.

**Retry.** A generation attempt can fail as data (`ok: false` from path
building) or as a typed throw (`MaskRepairError`, `BoardInvariantError`). All
three are retried: a new internal seed is derived deterministically from
`(params.seed, attempt)` — attempt 0 is the seed itself unmodified — and the
whole pipeline reruns from mask generation, up to
`GenerateBoardOptions.maxAttempts` (default 8, `DEFAULT_MAX_ATTEMPTS`).
Cut-and-orient contributes nothing to that list: it has no refusal to model.

Any other thrown error (a malformed segment, a corrupt CSR offset) is
deliberately **not** caught as retryable and propagates immediately, so a real
bug surfaces as itself rather than as eight identical retries disguised as an
unsolvable board.

**Exhaustion.** When every attempt fails, `generateBoard` throws
`GenerationFailedError` with every attempt's failure reason attached
(`detail.attemptFailures`). What is left that can exhaust is the mask-repair
floor at very small gridSize with very low fillFraction; 1000 seeds per size
at gridSizes 20, 40 and 100 clear it at both piece-length regimes
(`generate.heavy.test.ts`).

### rendering (S5) and game (S6)

Both consume a finished `Board` and nothing else. Neither may reach into the
generator's intermediate stages, and neither may mutate `Board` — removal state
lives in the game layer as a separate removed-set, so that restarting a board
means dropping that set rather than regenerating.

---

## Fixtures

`test/fixtures/` provides synthetic inputs so no stream waits on another:

| Builder                  | Produces                                                            | Used by        |
| ------------------------ | ------------------------------------------------------------------- | -------------- |
| `makeMask(spec)`         | A `Mask` from an ASCII-art string or a rectangle, regions labelled  | S2, S4         |
| `makePath(mask)`         | A trivially-correct boustrophedon path over a rectangle             | S3, S4         |
| `joinRegionPaths(paths)` | One multi-region walk from several single-region ones               | S3, S4         |
| `makeBoard(spec)`        | A small hand-checkable `Board`, including a deliberately cyclic one | S3, S4, S5, S6 |

ASCII specs keep the failing case readable in a test report, which matters more
than it sounds when six agents are reading each other's test failures.
