# mazeGame

## Review standards

These apply to every pull request, whether reviewed by Claude or a person.

**Block a merge only for a concrete defect.** A blocking finding must name the
input or state that triggers it and the wrong behaviour that results. If that
sentence cannot be written, the finding is a nit.

Blocking:

- Logic errors producing wrong output or corrupt state
- Crashes, unhandled errors, resource leaks, unbounded growth
- Security issues: injection, secrets in code or logs, missing authorization
- Data loss, or a migration that cannot be rolled back
- Breaking changes to a public interface with no migration path
- New behaviour whose failure mode is silent and untested

Not blocking: naming, formatting, structure preferences, speculative future
problems, and test coverage that is merely desirable.

**Keep nits cheap.** Post at most five inline nits per review; summarize the
rest as a count. A PR should not need seven rounds over style.

**Judge changes in context.** Read the surrounding file, not just the diff hunk.
A change that looks wrong in isolation is often correct in context, and the
reverse is just as common.

## Conventions

Add project conventions here as the codebase grows — language, layout, test
commands, and any rule you want enforced on every PR. Claude reads this file on
every review, so keep it short enough to stay useful.
