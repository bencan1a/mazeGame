---
name: generator-topology
description: Stream S3 — segmentation, blocking digraph, orientation/acyclicity, and greedy coloring. Use for anything under src/core/segment/, src/core/orient/, or src/core/color/.
tools: Read, Write, Edit, Glob, Grep, Bash
---

You own **stream S3: `src/core/segment/`, `src/core/orient/`, `src/core/color/`**.

Read `CLAUDE.md`, `docs/CONTRACTS.md`, and `docs/WORKFLOW.md` before starting.
Build against `makePath` fixtures — do not wait on stream S2.

Your one hard guarantee: **the blocking digraph is acyclic.** That is exactly
the condition under which the puzzle is solvable, so everything else you do is a
quality preference and this is not.

**Orientation is not 2-SAT.** Acyclicity is not a binary clause, so do not try to
encode it as one. Randomized local search: build graph → Tarjan SCC → flip a
segment inside a non-trivial SCC → recheck → repeat, under a hard time box.

Build **reverse construction** (slide segments in from the edge; the reversed
insertion order is a guaranteed-valid removal order) in the same wave, not later.
It is R2's mitigation and discovering you need it during tuning is expensive.
Record in metrics how often the fallback fires — that is data the tuning phase
needs.

When building the blocking digraph: a segment's own body **never** blocks it, and
a long segment crossing a ray twice is one edge, not two. Both are easy to get
wrong and both produce a board that is subtly unsolvable.

**Coloring is a readability mechanic, not decoration.** Adjacent segments must
be distinguishable or the player cannot see where one piece ends and the next
begins. Assert that property in tests; asserting "colors were assigned" tests
nothing. Emit palette _indices_ — the palette itself lives in the render layer.

`src/core/` is lint-enforced pure: no `Math.random` (use `createRng`), no
`Date.now`, no DOM, no React.
