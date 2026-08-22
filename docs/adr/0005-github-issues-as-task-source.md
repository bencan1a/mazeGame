# ADR-0005: GitHub Issues as the task source of truth

**Status:** Accepted; the role of `docs/backlog.md` is amended by
[ADR-0007](./0007-generated-backlog-not-committed.md)

## Context

One human and several concurrent agents need a shared task list. Two options:
an in-repo markdown board, or GitHub Issues.

An in-repo board is offline and versioned with the code, but every claim and
status change is a commit, and concurrent agents editing one file conflict
constantly — the coordination substrate would itself be the contention point.

## Decision

GitHub Issues are authoritative: one issue = one branch = one PR. Claiming is
assignment. `docs/backlog.md` is the human-readable seed and index, and
`scripts/seed-github.mjs` creates labels, milestones, and issues from it
idempotently.

## Consequences

- Agents need GitHub access to claim work. An agent without it reads
  `docs/backlog.md` and gets its task from the human.
- `docs/backlog.md` can drift from the issues. The issues win; the backlog is
  regenerable and is not a status board.
- Claiming is atomic and visible, so two agents cannot silently take the same
  task.
