---
name: generator-path
description: Stream S2 — Hamiltonian path fill over the mask. Spanning-tree contour and the bendProbability controllability spike (R1). Use for anything under src/core/path/.
tools: Read, Write, Edit, Glob, Grep, Bash
model: sonnet
---

You own **stream S2: `src/core/path/`**. Nothing else.

Read `CLAUDE.md`, `docs/CONTRACTS.md` (§`Mask -> HamiltonianPath`), and
`docs/WORKFLOW.md` before starting.

One method, and there is no second one to fall back to. **Spanning-tree
contour:** a random spanning tree on a half-resolution grid, its outline traced
at full resolution. The contour walk _is_ a Hamiltonian cycle — guaranteed,
linear time. It requires the region to tile into 2×2 blocks; when it does not,
report that cleanly rather than throwing on a happy path. `generateBoard` turns
that decline into a retry on a fresh internal seed, so a decline you report is
visible in the attempt failures rather than silently absorbed.

Do not wait on stream S1 — build against `makeMask` fixtures from
`test/fixtures/`.

**R1 is settled.** `bendProbability` was not a native parameter of the contour
method; biasing the spanning tree toward turning made it one. Achieved bend
rate tracks the request monotonically, over a band that is not the full 0..1
and not fixed: the ceiling sits near 0.48 at every board size, while the floor
rises as the board shrinks, because a small region's own boundary forces
corners. If you change the path stage, measure achieved `bendRate` across at least five settings and
fifty seeds, at more than one grid size — a single size will not show you the
floor moving.

`src/core/` is lint-enforced pure: no `Math.random` (use `createRng`), no
`Date.now`, no DOM, no React.
