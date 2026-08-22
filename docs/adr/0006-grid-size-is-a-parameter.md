# ADR-0006: Grid size is a parameter, so R3 is a performance risk

**Status:** Accepted
**Amends:** PRD §7 risk R3

## Context

PRD §7 states R3 as **"100×100 may simply not be fun"** — thousands of segments
times even a fast animation is a multi-hour board — and mitigates it by having
the metrics harness expose the problem before the renderer exists, with "be
willing to conclude the real ceiling is ~50×50" as the fallback.

That framing treats grid size as a product decision to be made once and lived
with. It is not. `gridSize` is a generation parameter, live in the dev panel and
selectable per board. A 100×100 board taking hours is a property of choosing
100×100, the way a 25×25 nonogram takes longer than a 5×5 one. The player picks
a size. There is no decision to de-risk.

An agent reading the PRD directly would reasonably re-raise the fun question at
large sizes, so the reframing needs to be written down rather than assumed.

## Decision

R3 is reframed: **100×100 may not hold performance.** The measurable claims are
PRD §2 goal 3 — generation under 1s, 60fps pan and zoom, and an offscreen buffer
inside a memory cap that iOS Safari will tolerate.

Playability at large grid sizes is not a PoC gate. Whether the _game_ is fun
remains goal 2, and is answered by playtesting at whatever sizes are pleasant to
play.

## Consequences

- **The headless harness no longer covers R3.** It measures generation time and
  nothing else about performance; frame rate and memory need a canvas on real
  hardware. The PRD's "harness before renderer will expose this" reasoning holds
  for parameter _range_, but not for R3.
- **Device performance work moves earlier.** A bare canvas benchmark — a
  3000×3000 offscreen buffer, a few hundred synthetic polylines, blitted per
  frame — needs neither generator nor renderer, so it runs during Wave 1 and
  validates the two-layer `drawImage` architecture before anything is built on
  top of it. The full device pass moves from Wave 4 to the end of Wave 3.
- **The M2 sweep gate loses its grid-ceiling question** and keeps its real one:
  does the parameter space have usable difficulty range?
- If 100×100 turns out to be unreachable on real hardware, that is an
  architecture finding for the renderer. Shipping at a smaller maximum is then a
  recorded retreat from a stated PoC goal — not a silent default.
