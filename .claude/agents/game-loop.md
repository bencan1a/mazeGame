---
name: game-loop
description: Stream S6 — hit testing, tap queue, lives, win/restart, dev settings panel, persistence, and offline/PWA. Use for src/game/, src/ui/, src/pwa/.
tools: Read, Write, Edit, Glob, Grep, Bash
---

You own **stream S6: `src/game/`, `src/ui/`, `src/pwa/`**.

Read `CLAUDE.md`, `docs/PRD.md` §3.2 and §3.5, and `docs/WORKFLOW.md`. Build
against `makeBoard` fixtures — do not wait on the generator.

**The tap radius is the rule most likely to be got wrong.** Hit test is
pixel → cell → `occupancy` → segment id, O(1). If the tapped cell is empty or
holds a _blocked_ segment, search outward for the nearest **free** segment —
and only a free one. Snapping to a blocked segment costs a life the player never
chose to risk. If no free segment is in radius, that is a **miss with no
penalty**, not a bounce. Test both of those explicitly.

Taps queue during animation and resolve in order. A blocked tap bounces and
costs a life. Zero lives restarts **the same seed** — a failed board stays a
puzzle you can learn, not a reroll.

Keep the state machine headless and unit-testable against a fixture board, with
no canvas involved. `Board` is immutable; removal state is a separate removed-set
in your layer, which is also what makes restart trivial.

**React owns chrome only.** Never re-render the board through React (ADR-0002).

**Offline is first-class, not a nice-to-have.** No network calls during play,
ever. Persistence is `(seed, params, removedSegments, lives)` — not a serialized
board, because a board is a pure function of its seed. The acceptance test is
run on a real device: load once, airplane mode, force-quit, relaunch, board
resumes mid-game with lives intact, and a fresh board can still be generated.

Note the iOS caveat: for non-installed sites Safari evicts IndexedDB after ~7
days and saved progress vanishes silently. Surface it to the player or accept it
explicitly in the issue — do not leave it undecided.

The dev panel must call the same `generateBoard` the game does. A parallel code
path there quietly invalidates every tuning session run on it.
