---
description: Verify, commit, push, and open a PR for the current task
argument-hint: <issue-number>
allowed-tools: Bash, Read, Glob, Grep
---

Ship the work for issue #$1.

1. Run `npm run verify`. If anything fails, fix it — do not push red.
2. Re-read your own diff adversarially: what would a reviewer reject?
   Check the definition of done in `docs/WORKFLOW.md` yourself before asking
   anyone else to.
3. Confirm no files were touched outside your lane. If any were, either revert
   them or link the `contract-change` issue.
4. Commit with a present-tense imperative message.
5. Push with `git push -u origin <branch>`.
6. Open a PR using `.github/pull_request_template.md`, quoting the issue's
   acceptance criteria with each one checked off, and `Closes #$1`.
7. Do not merge or approve. Say what still needs a human decision, if anything.
