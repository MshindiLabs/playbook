# Upstream provenance

Some skills and agents in this package are ported from
[cursor/plugins](https://github.com/cursor/plugins) at commit
`d42aff08aa58965d2735c4ead61a9af82b89d0d0`.

- `pstack` is MIT licensed, Copyright (c) 2026 Lauren Tan.
- `cursor-team-kit` and `thermos` are MIT licensed, Copyright (c) 2026 Cursor.

Each ported skill directory carries its upstream `LICENSE.txt`. Edit the ported files here, not
upstream. Pull upstream changes by hand and record what differs in the `Changes` column.

`Local` is a path relative to `playbook/`: a skill directory or a single file.
`pnpm --filter playbook test` checks that every listed path exists, is agent-neutral and has
links that resolve.

| Local                                       | Upstream                                                 | Changes                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/unslop`                             | `pstack/skills/unslop`                                   | Description rewritten to trigger phrases; body unchanged.                                                                                                                                               |
| `skills/deslop`                             | `cursor-team-kit/skills/deslop`                          | Diff base is the repo's default branch; added the repo-rules comment sentence.                                                                                                                          |
| `skills/technical-writing`                  | `pstack/skills/technical-writing`                        | Description rewritten; slash-command and swarm wording removed; skill reference uses the skill-name form.                                                                                               |
| `skills/why`                                | `pstack/skills/why`                                      | Sibling pointer now names the `explain-flow` skill.                                                                                                                                                     |
| `skills/architect`                          | `pstack/skills/architect`                                | Dropped the arena line; description allows a rigor workflow step.                                                                                                                                       |
| `skills/tdd`                                | `pstack/skills/tdd`                                      | Body unchanged; description keeps the narrow trigger.                                                                                                                                                   |
| `skills/correct`                            | `pstack/skills/correct`                                  | Operator becomes the user; agent instruction file names AGENTS.md or CLAUDE.md; on request only.                                                                                                        |
| `skills/blast-radius`                       | `pstack/skills/blast-radius`                             | Dropped the arena step; sibling skills renamed to `explain-flow`, `why` and `unslop`.                                                                                                                   |
| `skills/thermo-nuclear-code-quality-review` | `thermos/skills/thermo-nuclear-code-quality-review`      | Description rewritten; body unchanged.                                                                                                                                                                  |
| `skills/rigor-mode`                         | `pstack/skills/poteto-mode`, `pstack/skills/principle-*` | Renamed. Principles become plain files under `principles/`; `opening-a-pr` replaced by `finishing`; only six playbooks kept; runs on request only; delegation, autonomy and tooling made agent-neutral. |
| `skills/no-comments`                        | `pstack/skills/no-comments`                              | Spawn step made agent-neutral with the comment rules as the brief; slash commands and skill references use the skill-name form; principle links stand alone.                                            |
| `agents/public/comment-reviewer.md`         | `pstack/agents/comment-sicko.md`                         | Persona removed; rules moved to the `no-comments` skill references; sixth keep rule for repo-required comments.                                                                                         |
| `skills/typescript-best-practices`          | `pstack/skills/typescript-best-practices`                | Opening paragraph names repo rules and sibling skills; description triggers on .ts and .tsx; principle links stand alone.                                                                               |
