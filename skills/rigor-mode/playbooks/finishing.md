### Finishing

Invoked at the end of every other playbook that changes code.

Work from a git worktree or branch off trunk, and keep unrelated work out of it. Rebase into small, landable commits.

1. Run the `deslop` skill over the diff before commit.
2. Run the `no-comments` skill over the diff before review.
3. Run the `run-pre-pr-checks` skill, then open the PR with the `create-pr` skill.

Stack follow-ups by base branch.
