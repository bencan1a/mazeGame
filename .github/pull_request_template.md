Closes #

<!-- The reviewer agent reads the diff. Write only what the diff cannot show.
     No summary of the implementation, no file-by-file tour, no test names. -->

## Impact

<!-- One or two sentences: what a player or the project can now do. -->

## Acceptance criteria

<!-- Copy verbatim from the issue. A loose restatement is worse than none —
     the reviewer checks these against the code. -->

- [ ]

## Exceptions

<!-- Write "none" if none apply. One line each:
     - shared file touched -> link the `contract-change` issue
     - file outside this PR's stream -> why
     - new runtime dependency -> why
     - deviation from an ADR -> which, and why -->

## Left undone

<!-- Deliberate omissions, known gaps, anything you are unsure about.
     Absence of code is invisible in a diff. Write "nothing" if nothing. -->

## Definition of done

- [ ] `npm run verify` passes locally
- [ ] Generator changes covered by property-based invariant tests
- [ ] Determinism preserved — same `(seed, params)` gives an identical board
- [ ] `src/core/` still imports nothing from `ui/`, `render/`, or `game/`
- [ ] No files touched outside this PR's stream (or a `contract-change` issue is linked)
- [ ] No new runtime dependency (or justified under Exceptions)
- [ ] Branch contains the current `main`, with checks re-run against it
