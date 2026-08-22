# ADR-0004: The generator is a pure function of (seed, params), enforced by lint

**Status:** Accepted
**Source:** PRD §4.6

## Context

The generator must be callable identically from three places: the dev tuning
panel, a headless test script, and the game loop. The PRD names this as the rule
most likely to be violated in week two, and violating it costs the tuning
harness — which is the instrument the whole difficulty question depends on.

The violations are always small and reasonable-looking in isolation: a
`Math.random()` for a tie-break, a `Date.now()` for a "unique" seed, a
`window.devicePixelRatio` read because the caller happened to have it.

With several agents working concurrently, "everyone remembers the rule" is not a
control.

## Decision

`src/core/**` and `src/harness/**` are enforced pure by ESLint:

- no `react` / `react-dom` imports
- no imports from `ui/`, `render/`, `game/`
- no `window`, no `document`
- no `Math.random` — use `createRng(seed)` from `src/core/rng.ts`
- no `Date.now`

Violating any of these fails `npm run lint`, which fails CI.

The single public entry point is `generateBoard(params: GenParams): Board`.

## Consequences

- Timing instrumentation (`generationMs`) is measured by the _caller_ and passed
  in, not read inside the generator.
- Seeds come from params. A "random board" button lives in the UI layer, where
  it generates a seed and hands it down.
- Testing the generator needs no DOM, so the whole pipeline runs in a plain Node
  test environment and the sweep harness is trivially possible.
