# Upstream provenance

Some skills and agents in this package are ported from
[cursor/plugins](https://github.com/cursor/plugins) at commit
`d42aff08aa58965d2735c4ead61a9af82b89d0d0`.

- `pstack` is MIT licensed, Copyright (c) 2026 Lauren Tan.
- `cursor-team-kit` and `thermos` are MIT licensed, Copyright (c) 2026 Cursor.

Four more skills and two reference sets are ported from
[mattpocock/skills](https://github.com/mattpocock/skills) at commit
`49dd158d1076134a641b33efb035946536778336` (plugin version 1.3.1), MIT licensed,
Copyright (c) 2026 Matt Pocock. They are listed in the second table.

Each ported skill directory carries its upstream `LICENSE.txt`. A reference set folded into a
skill from a different upstream carries that upstream's licence beside the skill's own, as
`LICENSE-<name>.txt`. Edit the ported files here, not
upstream. Pull upstream changes by hand and record what differs in the `Changes` column.

`Local` is a path relative to the package root: a skill directory or a single file.
An automated check enforces that every listed path exists, is agent-neutral and has links that
resolve.

| Local                                       | Upstream                                                 | Changes                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/unslop`                             | `pstack/skills/unslop`                                   | Description rewritten to trigger phrases; body unchanged.                                                                                                                                               |
| `skills/deslop`                             | `cursor-team-kit/skills/deslop`                          | Diff base is the repo's default branch; added the repo-rules comment sentence.                                                                                                                          |
| `skills/technical-writing`                  | `pstack/skills/technical-writing`                        | Description rewritten; slash-command and swarm wording removed; skill reference uses the skill-name form; commit-message and PR-body format left to their own skills; code indentation follows the repo.                                                                                               |
| `skills/why`                                | `pstack/skills/why`                                      | Sibling pointer now names the `explain-flow` skill.                                                                                                                                                     |
| `skills/architect`                          | `pstack/skills/architect`                                | Dropped the arena line; description allows a rigor workflow step; points at the deep-modules reference.                                                                                                                                       |
| `skills/tdd`                                | `pstack/skills/tdd`                                      | Body unchanged; description keeps the narrow trigger.                                                                                                                                                   |
| `skills/correct`                            | `pstack/skills/correct`                                  | Operator becomes the user; agent instruction file names AGENTS.md or CLAUDE.md; on request only.                                                                                                        |
| `skills/blast-radius`                       | `pstack/skills/blast-radius`                             | Dropped the arena step; sibling skills renamed to `explain-flow`, `why` and `unslop`.                                                                                                                   |
| `skills/thermo-nuclear-code-quality-review` | `thermos/skills/thermo-nuclear-code-quality-review`      | Description rewritten; body unchanged.                                                                                                                                                                  |
| `skills/rigor-mode`                         | `pstack/skills/poteto-mode`, `pstack/skills/principle-*` | Renamed. Principles become plain files under `principles/`; `opening-a-pr` replaced by `finishing`; only six playbooks kept; runs on request only; delegation, autonomy and tooling made agent-neutral. |
| `skills/no-comments`                        | `pstack/skills/no-comments`                              | Spawn step made agent-neutral with the comment rules as the brief; slash commands and skill references use the skill-name form; principle links stand alone.                                            |
| `agents/public/comment-reviewer.md`         | `pstack/agents/comment-sicko.md`                         | Persona removed; rules moved to the `no-comments` skill references; sixth keep rule for repo-required comments.                                                                                         |
| `skills/typescript-best-practices`          | `pstack/skills/typescript-best-practices`                | Opening paragraph names repo rules and sibling skills; description triggers on .ts and .tsx; principle links stand alone.                                                                               |

## From mattpocock/skills

| Local | Upstream | Changes |
| --- | --- | --- |
| `skills/grilling` | `skills/productivity/grilling` | Description rewritten to on-request trigger phrases; emoji markers replaced with text; the sub-agent step made agent-neutral; closing pointer names the `plan-change` and `break-into-issues` skills. |
| `skills/handoff` | `skills/productivity/handoff` | Claude-only frontmatter keys dropped; on-request rule moved to the description; contents list added (goal, state, decisions, next step, not verified, suggested skills); Skill-tool wording removed. |
| `skills/domain-modeling` | `skills/engineering/domain-modeling` | ADR format file dropped in favour of the `draft-adr` skill; glossary format moved to `references/`; per-context ADR folders removed from the layout; respects an existing vocabulary file. |
| `skills/break-into-issues` | `skills/engineering/to-tickets` | Renamed. Tracker setup skill and its triage labels removed; the tracker is found from the project's own docs, then `gh`, then another tracker tool, then local files; publishing waits for the user's approval; tickets become issues. |
| `skills/architect/references/deep-modules.md` | `skills/engineering/codebase-design/SKILL.md` | Folded into `architect` as a reference, not a skill; frontmatter removed; the design-it-twice pointer dropped because it needs parallel sub-agents. |
| `skills/architect/references/deepening.md` | `skills/engineering/codebase-design/DEEPENING.md` | Link retargeted to `deep-modules.md`. |
| `skills/technical-writing/references/writing-for-agents.md` | `skills/productivity/writing-for-agents/SKILL.md` | Folded into `technical-writing` as a reference, not a skill; frontmatter removed; the skill-mechanics file dropped because it describes one agent's frontmatter, with its split-by-invocation rule kept inline. |
