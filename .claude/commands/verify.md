---
description: Run the full quality gate and fix what it finds
allowed-tools: Bash, Read, Edit, Glob, Grep
---

Run `npm run verify` (format, lint, typecheck, tests, coverage) and fix every
failure.

Then hand-check the things no linter catches:

- Does `src/core/` still take randomness or time only through its parameters?
- Are generator invariants covered by **property** tests, not just examples?
- Same `(seed, params)` → identical board?
- Any per-segment or per-cell object introduced into a hot path?

Report what failed and what you changed. If something is failing for a reason
outside this task's scope, say so rather than widening the change.
