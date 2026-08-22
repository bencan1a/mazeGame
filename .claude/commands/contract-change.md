---
description: Propose a change to a shared contract file
argument-hint: <what needs to change and why>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

Propose a contract change: $ARGUMENTS

Shared files are `src/core/types.ts`, `src/core/generate.ts`, `src/core/rng.ts`,
`src/core/grid.ts`, `test/fixtures/**`, and `docs/**`. Changing them affects
every stream at once, which is why this is not a normal task.

1. State the change precisely: which type or fixture, before and after.
2. List which streams it affects and what breaks for each.
3. Say whether it can be additive instead of breaking. Prefer additive.
4. Open an issue labelled `contract-change` with all of the above, and **wait
   for the human**. This is the one place where blocking on a human is correct.
5. Once accepted: land the type change plus fixture updates in a single small
   PR, on its own, with no feature work attached — a mixed PR cannot be reviewed
   for the thing that matters.
6. Comment on the affected streams' issues so nobody is surprised.
