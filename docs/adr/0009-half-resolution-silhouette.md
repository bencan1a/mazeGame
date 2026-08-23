# ADR-0009: The silhouette is drawn at half resolution and upscaled 2×

**Status:** Accepted
**Source:** PRD §4.2 step 1, step 2
**Amends:** PRD §4.2 step 1.6 (parity absorption)

## Context

The spanning-tree contour is the PRD's primary path-fill method, and the only
one that guarantees a Hamiltonian path in linear time. It buys that guarantee
with a precondition: the region has to partition into whole 2×2 blocks. The
contour is traced by giving each full block an internal 4-cycle and splicing
neighbouring cycles together along tree edges, so a block with only three of its
four cells on the path has no cycle to splice and the construction has nothing
to say about it.

An organic boundary drawn directly at full resolution essentially never
satisfies that. Reproducing the pre-existing full-resolution radial blob and
running `classifyTiling` over it gives **0 of 300 seeds tileable at grid sizes
20, 40 and 100** — and `classifyTiling` already tries all four lattice offsets,
so this is not a question of where the lattice is placed. It is not near-miss
behaviour either: a boundary that wanders cell by cell produces mixed blocks
everywhere along its length, and the larger the silhouette the more of them
there are. Waiting for a lucky seed is not a strategy.

Three alternatives lose:

- **Repair the mask into alignment after drawing it at full resolution.**
  Snapping boundary cells to block edges is erosion and dilation by another
  name. It can disconnect the region, and it can re-open the 1-cell spurs and
  hairline necks that PRD §4.2 step 1.3 exists to amputate — with no guarantee
  of terminating in an aligned state, so the tiling check would still have to
  reject and fall back.
- **Let backbite handle organic masks and treat the contour as the exception.**
  Backbite is iterative and mixes toward a random path with no convergence
  guarantee, where the contour is linear time and always succeeds on a region
  that tiles. Making the fallback the default puts generation inside the 1s
  budget (PRD §2 goal 3) at risk and leaves the primary method as dead code
  reachable only by hand-authored fixtures.
- **Accept the constraint and hand-author block-aligned silhouettes.** The PoC's
  silhouettes are procedural; a library of drawn shapes is explicitly out of
  scope (PRD §8).

## Decision

`generateBlob` draws the radial silhouette on a lattice of `floor(gridSize / 2)`
per axis, then upscales every half-resolution cell into a 2×2 block of
full-resolution cells at `(2·hx, 2·hy)`.

Every region it produces is therefore block-aligned to lattice offset (0, 0) **by
construction**, not by getting lucky. The harmonics that give the shape its lobes
are untouched — they run on the half-resolution lattice exactly as they ran on
the full one — so the silhouette is coarser in outline detail, not simpler in
overall shape.

Where `gridSize` is odd, the half size rounds down and the leftover
full-resolution row and column are never written, so they stay outside the
silhouette rather than becoming path cells that no block covers.

## Consequences

- **Outlines are pixelated at 2-cell resolution.** This is the price and it is
  accepted. It bites hardest at the bottom of the grid-size range: at the
  minimum of 20, the shape is decided on a 10×10 lattice.
- **The contour method succeeds on its first offset.** `classifyTiling` keeps
  its four-offset search, because hand-built fixtures and any future non-block
  source still need it, but a procedural blob always tiles at (0, 0).
- **Parity absorption has nothing left to do on a procedural blob.** Every 2×2
  block holds two cells of each checkerboard colour wherever it sits, so a
  region built from whole blocks is exactly balanced and PRD §4.2 step 1.6
  absorbs zero cells. `Mask.unvisited` stays in the contract — it is still
  reachable from a hand-built mask — but the 1–3 unvisited cells the PRD budgets
  for are not something this generator will produce.
- **Mask repair must run at half resolution, before the upscale.** Erosion or
  dilation applied to an already-upscaled region can shave a single cell off a
  2×2 block and destroy the alignment this ADR exists to guarantee, where the
  same operation at half resolution moves whole blocks and cannot. It is also
  four times cheaper. Nothing enforces the ordering yet; `generateRadialBlob`
  takes its lattice as a parameter so the repair stage can be inserted between
  it and `upscale2x` when it lands.
- **Reversing this is a mask-stage change, not a pipeline change.** Nothing
  downstream of the mask knows the silhouette was built from blocks; a future
  generator that satisfies the tiling precondition some other way can replace
  this one without touching path, segmentation, orientation or validation.
