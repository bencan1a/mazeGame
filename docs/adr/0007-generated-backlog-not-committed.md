# ADR-0007: The generated backlog index is not committed

**Status:** Accepted
**Amends:** [ADR-0005](./0005-github-issues-as-task-source.md)

## Context

ADR-0005 made GitHub Issues authoritative and described `docs/backlog.md` as
"the human-readable seed and index", generated from `scripts/backlog.json` and
committed alongside it.

Committing it turned out to be wrong in two ways that only showed up once the
issues were live:

1. **It drifts, silently and immediately.** The moment anyone edits an issue,
   closes one, or adds an assignee, the committed file disagrees with reality —
   while still reading like a status board. A stale board that looks current is
   worse than no board, and with several agents reading it, worse in
   proportion to how many of them trust it.
2. **It fights the formatter.** It is machine-generated with compact markdown
   tables; Prettier reformats them with alignment padding. Every regeneration
   produced a diff, and a hand-edit to improve its readability broke
   `format:check` in CI — a generated file failing a lint gate that exists for
   hand-written code.

The second is the annoyance. The first is the reason.

## Decision

`docs/backlog.md` is **not committed**. It is gitignored and prettierignored.

`node scripts/seed-github.mjs --render` still writes it, so anyone who wants a
readable local index can have one. `scripts/backlog.json` remains committed as
the seed data the issues were generated from.

## Consequences

- Documentation links point at the GitHub issues, or at
  `scripts/backlog.json` for the seed data — never at a rendered index.
- An agent without GitHub access reads `scripts/backlog.json` and takes its
  task from the human, as ADR-0005 already provided for.
- Adding work means editing `scripts/backlog.json` and re-running the seeder,
  which creates only what is missing; or just opening an issue directly. The
  seeder never rewrites an existing issue unless asked with `--rewrite-bodies`,
  and never touches one that has an assignee.
- There is exactly one status board, and it is the issue list.
