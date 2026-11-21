# Commit and PR hygiene

These rules apply to every commit message, PR title, PR body, and release note a skill produces.

**Ticket reference — always include one when it exists.**

- Derive the ticket, in priority order, from:
  1. The user's explicit input for this run
  2. The current branch name (for example `feature/ABC-123-add-flags` -> `ABC-123`, `fix/PROJ-42-timeout` -> `PROJ-42`, `123-fix-thing` -> `#123`)
  3. Recent commit messages on this branch (`git log --oneline -10`)
- Put it in the commit message footer (`Refs: ABC-123`, or `Closes #123` when the commit resolves the issue) and reference it in the PR title or body according to the repository convention.
- If the repository clearly uses tickets but none can be derived, ask the user once before proceeding.
- Never invent a ticket number. If genuinely none exists, proceed without one.

**No agentic annotations — ever.**

- Never add, and always strip when found: `Co-authored-by:` lines referencing AI tools, `Generated with ...`, `Made-with: ...`, robot emoji watermarks, "This commit/PR was created by ..." notes, or any other AI/agent attribution or tool advertisement.
- This applies to commit messages, amended messages, PR titles, PR bodies, release notes, and changelog entries.
- When amending, rebasing, cherry-picking, or reusing an existing message, remove any such annotations already present before continuing.
