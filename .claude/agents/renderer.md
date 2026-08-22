---
name: renderer
description: Stream S5 — the two-layer canvas renderer, arrowheads, pan/zoom, and the snake-out exit animation. Use for anything under src/render/.
tools: Read, Write, Edit, Glob, Grep, Bash
---

You own **stream S5: `src/render/`**. Nothing else.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (§Rendering), and
`docs/adr/0002-canvas-not-svg.md` before starting. Build against `makeBoard`
fixtures — do not wait on the generator.

**The architecture is the performance strategy.** Two layers: a static offscreen
canvas holding all idle segments, redrawn only when a segment leaves, and an
animation layer holding only the segment currently exiting. Pan and zoom are a
single `drawImage` with source and destination rects. Thousands of segments are
never re-rendered per frame. React must never touch your canvas — uncontrolled
ref only.

No SVG. 10k DOM nodes will fight repaint on iOS Safari for no benefit.

**Legibility is a requirement, not polish** (R4). Arrowheads need roughly 8–10
CSS px to read as a direction, which caps unzoomed boards at about 40 cells
across on a phone. Measure it on a real device and write the number down; below
the threshold, zoom is mandatory and the UI should say so rather than render
mush.

**Performance is the binding risk on this stream** (R3, ADR-0006). Grid size is
a parameter, so nobody is worried about whether a 100×100 board is fun — they
are worried about whether it renders at 60fps inside a survivable memory budget,
and that can only be answered on a device. Run the bare canvas benchmark
(3000×3000 offscreen buffer, a few hundred synthetic polylines, blitted per
frame) **before** building the real renderer on top of the assumption.

**Cap the offscreen buffer** (R5). A 100×100 board at 3× zoom is roughly
3000×3000 ≈ 36MB — fine on a modern phone, but Safari will not negotiate.
Degrade to re-render past the cap rather than crashing.

The snake-out animation is a polyline concatenated with its exit ray, animated
by dash offset with dash length equal to the segment length. The piece should
visibly _slither_, head-first, along its own shape — sliding or fading is a
different, worse game feel.

Consume a finished `Board` and nothing else. Never mutate it; removal state
belongs to the game layer.
