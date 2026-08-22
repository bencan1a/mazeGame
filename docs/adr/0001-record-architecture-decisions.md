# ADR-0001: Record architecture decisions

**Status:** Accepted

## Context

Several agents work on this repo concurrently and none of them share a memory.
A decision explained only in a PR comment is invisible to the agent that picks
up the next task, which is how a codebase ends up with two conventions for the
same thing.

## Decision

Significant decisions get a numbered file in `docs/adr/`. Records are immutable
once accepted; a change means a new record that supersedes the old one.

A decision qualifies if reversing it later would be expensive, or if a future
contributor would reasonably do the opposite without knowing why.

## Consequences

Agents read `docs/adr/` before proposing structural changes. Reviewers can point
at a record instead of re-arguing a settled question.
