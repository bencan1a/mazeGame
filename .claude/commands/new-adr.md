---
description: Write a new architecture decision record
argument-hint: <short title>
allowed-tools: Read, Write, Glob, Bash
---

Write an ADR for: $ARGUMENTS

1. Read `docs/adr/` to find the next number and match the existing format.
2. Write `docs/adr/NNNN-<slug>.md` with **Status**, **Context**, **Decision**,
   **Consequences**.
3. The Context section must say what the alternatives were and why they lose.
   An ADR that only records what was chosen is not worth the file.
4. Never edit an accepted ADR — supersede it with a new one and mark the old
   one superseded.
5. If this decision changes a rule in `CLAUDE.md` or `docs/`, update those in the
   same commit.
