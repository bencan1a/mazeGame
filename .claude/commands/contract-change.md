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
5. If the change adds a **required field to a shared type**, grep the tree for
   literal constructions of that type — `grep -rn '<TypeName>' src test scripts`
   — and fix every literal in the same PR. A caller that spreads the defaults is
   fine; one that names every field stops compiling the moment the field exists,
   and it will be green on its own branch until the two land together. That is
   how `main` broke in #62. Prefer an optional field with a default, or callers
   spreading `DEFAULT_GEN_PARAMS`, so the next contract change does not repeat
   this.
6. Once accepted: land the type change plus fixture updates in a single small
   PR, on its own, with no feature work attached — a mixed PR cannot be reviewed
   for the thing that matters.
7. Comment on the affected streams' issues so nobody is surprised.
