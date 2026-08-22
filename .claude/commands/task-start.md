---
description: Claim a backlog issue and set up its branch
argument-hint: <issue-number>
allowed-tools: Bash, Read, Glob, Grep
---

Start work on issue #$1.

1. Read the issue: its context, acceptance criteria, labels, and any comments.
   If it is already assigned to someone else, stop and say so.
2. Read `CLAUDE.md`, `docs/WORKFLOW.md`, and the `docs/CONTRACTS.md` section for
   this issue's stream.
3. Assign the issue to yourself and comment that you are claiming it.
4. Create the branch from the latest `main`:
   `agent/<stream>/$1-<slug>` — stream comes from the issue's `stream:` label.
5. Restate the acceptance criteria as a task list before writing any code.
6. Say which files you expect to touch, and confirm they are all inside your
   lane per the ownership table. If any are shared files, stop: that needs a
   `contract-change` issue first.
