# PR review automation

`main` is protected: changes land through pull requests, Claude reviews every
PR, and Claude's approval satisfies the required-review rule when it finds
nothing blocking.

## Moving parts

| Piece | Where | What it does |
| --- | --- | --- |
| Review workflow | `.github/workflows/claude-review.yml` | Reviews each PR, posts inline findings, submits APPROVE or REQUEST_CHANGES |
| Mention workflow | `.github/workflows/claude.yml` | Responds to `@claude` in PR and issue comments |
| Review standards | `CLAUDE.md` | What counts as blocking vs. a nit |
| Human-only paths | `.github/CODEOWNERS` | Paths Claude cannot approve changes to |
| Branch rules | `.github/rulesets/main-branch-protection.json` | The ruleset to apply to `main` |

## Setup

Three things have to be done in GitHub; none can be committed to the repo.

### 1. Add the auth secret

Generate a long-lived subscription token locally:

```bash
claude setup-token
```

Store the result as a repository secret named `CLAUDE_CODE_OAUTH_TOKEN` under
**Settings → Secrets and variables → Actions → New repository secret**.

The token is tied to the subscription of whoever generated it. If that account
ever loses access, reviews stop until the secret is replaced. For a setup that
does not depend on one person, use a Claude Console API key stored as
`ANTHROPIC_API_KEY` instead, and change the `claude_code_oauth_token:` line in
both workflows to `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`.

### 2. Install the Claude GitHub App

Install <https://github.com/apps/claude> on this repository. Without it the
workflows cannot authenticate as `claude[bot]`, and the approval step fails.

This is what makes approvals count — see [Why the identity matters](#why-the-identity-matters).

### 3. Apply the branch ruleset

Merge this PR first, so the `claude-review` check exists and can be selected as
a required status check. Then apply the ruleset:

```bash
gh api -X POST repos/bencan1a/mazeGame/rulesets \
  --input .github/rulesets/main-branch-protection.json
```

Or set the same thing by hand under **Settings → Rules → Rulesets → New branch
ruleset**, targeting the default branch:

- Restrict deletions
- Block force pushes
- Require a pull request before merging
  - Required approvals: **1**
  - Dismiss stale approvals when new commits are pushed: **on**
  - Require review from Code Owners: **on**
- Require status checks to pass → add **claude-review**
  - Require branches to be up to date before merging: **on**

Leave **Bypass list** empty. An admin bypass reopens the hole the ruleset exists
to close.

## Why the identity matters

GitHub deliberately ignores approvals from `github-actions[bot]` — a review
submitted with the default `GITHUB_TOKEN` shows in the UI but never satisfies a
required-approval rule. Approvals from a **GitHub App** or a machine-user PAT do
count.

The review workflow therefore does **not** set the `github_token` input. Left
unset, the action authenticates as the Claude GitHub App, and the `gh` CLI in
Claude's own tool calls inherits that App token, so `gh pr review --approve`
submits as `claude[bot]`.

**Verify this on the first PR.** Open a trivial PR and confirm that after
`claude[bot]` approves, the merge button goes green rather than still reporting
"1 approving review required". If it does not count, generate a token from a
custom GitHub App you own and pass it explicitly:

```yaml
      - name: Generate reviewer token
        id: reviewer-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.REVIEWER_APP_ID }}
          private-key: ${{ secrets.REVIEWER_APP_PRIVATE_KEY }}

      - name: Review and vote
        uses: anthropics/claude-code-action@v1
        with:
          github_token: ${{ steps.reviewer-token.outputs.token }}
          # ...
```

The custom app needs Contents (read), Issues (read), and Pull requests (write).

## Guardrails

The point of a required review is that something has to be true before code
merges. Automating the approver removes the human from that loop, so the
remaining guardrails are what keep the gate meaningful:

- **Claude approves only a clean PR.** A blocking finding produces
  REQUEST_CHANGES, which holds the merge until it is resolved.
- **Approvals are dismissed on every push.** A new commit re-opens the gate and
  triggers a fresh review, so an approval always refers to the code being merged.
- **Claude cannot approve changes to its own guardrails.** `CODEOWNERS` puts
  `.github/workflows/`, `.github/CODEOWNERS`, and `.github/rulesets/` behind a
  human approval, so the review job, the approval rule, and the owners file
  cannot be weakened by a Claude-approved PR.
- **Claude cannot approve its own PRs.** GitHub rejects an App's review on a PR
  that App authored. Anything Claude writes still needs a human.
- **No bypass actors.** Nothing routes around the rules, including admins.

What this setup does *not* give you is a second opinion on Claude's own
judgment. On a PR Claude did not author, its approval is the only approval, so
its blind spots are the system's blind spots. If you later want a human in the
loop on higher-risk changes without reviewing everything, widen `CODEOWNERS`
to those paths rather than raising the approval count.

## Day-to-day

- Reviews run on open, push, reopen, and ready-for-review. Drafts are skipped.
- Fork PRs are skipped: GitHub withholds secrets from fork runs, so the review
  cannot authenticate. Those need a human reviewer.
- Comment `@claude` on a PR to ask a question or request changes be made.
- Push a fix and the stale approval is dismissed and the review re-runs.
- Tune what gets flagged by editing `CLAUDE.md`.

## Cost

Each review is one Claude Code run against your subscription, capped at 40 turns
and a 30-minute job timeout. `cancel-in-progress` kills the review of a
superseded commit when you push again, so a rapid series of pushes costs one
review rather than one per push.
