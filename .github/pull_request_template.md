Closes #

## What changed

<!-- One paragraph. Why, not just what. -->

## Acceptance criteria

<!-- Quote the criteria from the issue and check each one off. Do not restate
     them loosely — copy them. -->

- [ ]

## Definition of done

- [ ] `npm run verify` passes locally
- [ ] Generator changes covered by property-based invariant tests
- [ ] No files touched outside this PR's stream (or a `contract-change` issue is linked)
- [ ] Determinism preserved — same `(seed, params)` gives an identical board
- [ ] `src/core/` still imports nothing from `ui/`, `render/`, or `game/`
- [ ] No new runtime dependency (or justified below)

## Notes for the reviewer

<!-- Trade-offs, anything deliberately left out, anything you are unsure about. -->
