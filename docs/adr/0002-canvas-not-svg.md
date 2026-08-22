# ADR-0002: Canvas for the board, SVG never, React for chrome only

**Status:** Accepted
**Source:** PRD §4.1, §4.5

## Context

A 100×100 board holds ~10,000 cells and several hundred segments. Three ways to
draw it:

- **SVG / DOM** — 10k nodes fighting repaint on iOS Safari.
- **Canvas re-rendered per frame** — thousands of polylines every frame during
  pan and zoom.
- **Canvas with an offscreen buffer** — draw once, blit per frame.

React re-rendering thousands of pieces is the single most likely performance
disaster in this project, and it is the kind that arrives gradually.

## Decision

The board is a `<canvas>` behind an **uncontrolled ref that React never touches**.
React owns chrome only: settings panel, lives display, menus.

Two canvas layers. A static offscreen layer holds all idle segments, redrawn
only when a segment leaves. An animation layer holds only the segment currently
exiting. Pan and zoom are a single `drawImage` with source and destination
rects.

No SVG. No game engine.

## Consequences

- Board state changes do not flow through React state, so the renderer needs its
  own imperative update path.
- Hit testing is arithmetic — pixel → cell → `occupancy` → segment id — rather
  than DOM event targets.
- The offscreen buffer is capped in size and degrades to re-render past the
  threshold, because a 3000×3000 buffer is ~36MB and iOS Safari will not
  negotiate (R5).
