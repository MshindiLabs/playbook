# playbook

Mshindi Labs Playbook: 63 agent skills for AI coding assistants — code review,
debugging, git and release workflow, testing, codebase orientation, and project setup.

A skill is a packaged set of instructions your agent loads when the task matches.
Instead of re-explaining how you want a migration reviewed or a commit written, you
install the skill once and the agent picks it up on its own from what you asked for.

Skills follow the [Agent Skills](https://agentskills.io/) format and work with Claude
Code, Codex, Cursor, Windsurf, Copilot, and other agents that read `SKILL.md` files.

---

## Start here

**1. Install the skills.** Run the line for your agent:

| Agent       | Command                                                       |
| ----------- | ------------------------------------------------------------- |
| Claude Code | `npx -y skills add MshindiLabs/playbook -g -y -a claude-code` |
| Codex       | `npx -y skills add MshindiLabs/playbook -g -y -a codex`       |
| Cursor      | `npx -y skills add MshindiLabs/playbook -g -y -a cursor`      |

Or all three at once:

```bash
npx -y skills add MshindiLabs/playbook -g -y -a codex -a cursor -a claude-code
```

This installs every skill for your user account in `~/.agents/skills` and symlinks them into each
agent. Add `-s <name>` to install one skill.

**2. Install the guard hooks.** Ask your agent to "install the guard hooks". The `guard-hooks`
skill prints the change to your agent config and applies it only after you agree. The guards stop
an agent from skipping git hooks, committing secrets, or committing straight to the default
branch. Afterwards, start a new session in Claude Code; in Codex, run `/hooks` and trust the new
hooks. Cursor imports the Claude Code entries.

**Use one route, not two.** This route is the one to prefer: it covers all three agents. The
Claude Code plugin below is an alternative that also carries the [agents](#agents). With both
installed, Claude Code offers each skill twice and a request can trigger the wrong copy.

- Moving to the plugin: remove these copies first (`npx skills list -g`, then
  `npx skills remove -g <name>`).
- Moving to this route: uninstall the plugin first
  (`/plugin uninstall playbook@mshindilabs-public`).

---

## Other ways to install

<!-- plugin-install -->

### Install as a Claude Code plugin

```text
/plugin marketplace add MshindiLabs/playbook
/plugin install playbook@mshindilabs-public
```

This gives you the skills below and the public agents. Update with
`/plugin update playbook@mshindilabs-public`. Do not combine it with an `npx skills` install of the
same skills (see [Start here](#start-here)).

Claude Code lists skill descriptions within a budget, 1% of the model's context window by default.
With this many skills the listing can overflow, and the skills you use least are then listed by
name only and stop triggering on their own. Run `/doctor` to check, and raise the budget in your
settings if needed (`0.02` is 2%):

```json
{ "skillListingBudgetFraction": 0.02 }
```

<!-- /plugin-install -->

### Install everything

```bash
npx skills add MshindiLabs/playbook --all
```

`--all` is shorthand for `--skill '*' --agent '*' -y`: every skill in this repo,
wired into every agent directory it detects, no prompts.

Add `-g` to install for your user account instead of the current project:

```bash
npx skills add MshindiLabs/playbook --all -g
```

### Install one skill, or a few

```bash
npx skills add MshindiLabs/playbook --skill review-changes
npx skills add MshindiLabs/playbook --skill review-auth,review-migration,check-query-safety
```

List what is available without installing anything:

```bash
npx skills add MshindiLabs/playbook --list
```

### Target specific agents

By default the installer detects the agents on your machine and wires the skills into
each one. Pass `--agent` to narrow that to specific agents, or `'*'` for all of them:

```bash
npx skills add MshindiLabs/playbook --all --agent '*'
```

Installs symlink by default so `npx skills update` keeps them current. Pass `--copy`
if you would rather have independent copies that never move under you.

### Try one without installing

```bash
npx skills use MshindiLabs/playbook@review-changes
```

Prints the skill as a prompt you can paste into any agent.

### Manual install

Skills are plain directories — copying one in works fine:

```bash
git clone https://github.com/MshindiLabs/playbook
cp -r playbook/skills/review-changes ~/.claude/skills/
```

For all of them at once, into any agent's skills directory:

```bash
cp -r playbook/skills/* ~/.claude/skills/
```

### Updating

```bash
npx skills update              # everything
npx skills update review-auth  # one skill
npx skills list                # what you have installed
npx skills remove review-auth  # uninstall
```

---

<!-- agents -->

## Agents

| Agent                | Role                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `reviewer`           | Generalist diff review, highest risk first, no praise                                     |
| `security-reviewer`  | Auth bypasses, missing ownership checks, IDOR, secrets in the diff and history, injection |
| `migration-reviewer` | Lock types, data loss, reversibility, backfills                                           |
| `builder`            | Builds one plan task test-first, runs the local gate, commits once, never pushes `main`   |
| `comment-reviewer`   | Finds and deletes needless comments in a diff and flags the code that needed them         |

<!-- /agents -->

## Using the skills

You do not invoke a skill by name. Ask for the work in your own words and the agent
matches your request against the installed descriptions:

| You say                                          | Skill that fires   |
| ------------------------------------------------ | ------------------ |
| "review my changes before I push"                | `review-changes`   |
| "is this migration safe to run in production?"   | `review-migration` |
| "did I commit an API key?"                       | `audit-secrets`    |
| "prod is throwing 500s, what's the blast radius" | `triage-error`     |
| "ship this to main"                              | `create-pr`        |
| "I'm new here, where do I start"                 | `onboard-codebase` |

Naming a skill directly (`use review-auth on this file`) works too, and is worth doing
when you want the deep pass rather than whatever the agent judged to be closest.

**Related skills know their boundaries.** `review-changes` is the generalist: it
flags auth, migration, and query issues in passing and then hands the deep pass to
`review-auth`, `review-migration`, `check-query-safety`, or `review-api`. Each skill's description
says what it owns and which sibling to prefer, so overlapping requests land in the
right place instead of the first match.

---

## The skills

### Review and audit

| Skill                | What it does                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-changes`     | Reviews a diff like an experienced teammate — highest-risk issues first, no leading praise. The generalist; hands deep passes to the specialists below.                                                  |
| `review-auth`        | Audits authentication and authorization paths for bypasses, missing ownership checks, and IDOR.                                                                                                          |
| `review-migration`   | Analyzes a schema migration for data-loss, locking, reversibility, and backfill risk before it runs in production. Names the actual lock type each operation takes.                                      |
| `check-query-safety` | Finds N+1 patterns, unbounded scans, SQL injection, over-fetching, and missing transaction boundaries in application queries.                                                                            |
| `review-api`         | Reviews a diff or a set of endpoints for API shape: one list envelope, route naming, validation at the HTTP boundary, bounded selector endpoints, error shape. Finds the project's own convention first. |
| `audit-secrets`      | Scans the working tree **and git history** for committed credentials — including secrets that survive after the file was deleted. Always says rotate, not delete.                                        |
| `audit-dependencies` | Reports CVEs, badly outdated packages, license risk, and genuinely unused dependencies. Read-only — pair with `upgrade-dependencies` to act on it.                                                       |

### Debugging and incidents

| Skill               | What it does                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `debug-issue`       | Works a dev-time bug from evidence to ranked hypotheses to the safest minimal fix.                                        |
| `triage-error`      | Live production error or page: locates the fault site, assesses blast radius, recommends a mitigation path.               |
| `triage-ci-failure` | Reads failing CI logs, classifies the failure, maps it to a local reproduction command, recommends the smallest safe fix. |
| `fix-failing-test`  | Gets one red test green by working out whether the test, the code, or both are wrong — without weakening assertions.      |

### Testing

| Skill               | What it does                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `add-test-coverage` | Writes tests for high-risk untested paths, runs them, and verifies they fail when the behaviour breaks.     |
| `add-missing-tests` | Read-only counterpart: reports what is untested and proposes the most valuable tests, without writing them. |
| `seed-test-data`    | Generates realistic fixtures and factory functions for a model, following the project's existing patterns.  |

### Git, PRs, and releases

| Skill                     | What it does                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `commit-changes`          | One clean Conventional Commit — explicit staging, validated message, no AI attribution.                                      |
| `new-branch`              | Creates a branch named `<prefix>.<type>.<TICKET>.<short-description>` from a fresh base, without stranding uncommitted work. |
| `amend-safely`            | Fixes the last commit's message or contents, with guardrails against rewriting history that has already shipped.             |
| `run-pre-pr-checks`       | Runs the project's real format/lint/typecheck/test scripts and reports a PASS/FAIL gate.                                     |
| `create-pr`               | Opens a PR to any target branch — validates state, commits pending work, pushes, writes the body.                            |
| `address-pr-review`       | Triages review comments, applies the changes, writes follow-up commits, and drafts the re-review summary.                    |
| `resolve-merge-conflicts` | Resolves conflict markers by understanding both sides' intent, never silently dropping work.                                 |
| `sync-branch-safely`      | Syncs a branch with its remote or base, stopping on anything ambiguous instead of defaulting to destructive.                 |
| `clean-branch`            | Finds stale local branches and confirms the list with you before deleting anything.                                          |
| `revert-change-safely`    | Backs out a pushed or merged change, assessing blast radius first.                                                           |
| `ship-release-candidate`  | Cuts an RC PR to main: checks conflicts, infers the version bump from commit history, drafts release-focused notes.          |
| `hotfix-release`          | Emergency fix on a release line — correct base tag, minimal change, merge-back plan for every affected branch.               |
| `prepare-release-notes`   | Turns a commit range into release notes grouped by user impact, with breaking changes and upgrade steps called out.          |

### Understanding a codebase

| Skill                   | What it does                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `onboard-codebase`      | Whole-repo orientation: entry points, architecture layers, conventions, test strategy, local gotchas.          |
| `explain-flow`          | Narrative end-to-end trace of one feature, endpoint, or job, grounded in the real execution path.              |
| `locate-implementation` | Answers "where is X handled" with a scannable map of definitions, registrations, and related types — no prose. |
| `map-dependencies`      | Inbound/outbound import map for a module, flagging cycles, tight coupling, god-modules, and orphaned code.     |

### Planning and scaffolding

| Skill               | What it does                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `plan-change`       | Implementation-ready plan before any code: scope, options, recommendation, phases, risks, verification.                       |
| `scaffold-feature`  | Skeleton files for a new feature that match the project's existing conventions.                                               |
| `draft-adr`         | Captures a technical decision as a durable ADR — context, options considered, decision, consequences.                         |
| `grilling`          | Questions a plan in rounds, each question with a recommended answer, until nothing is silently assumed. Runs only when asked. |
| `break-into-issues` | Splits a plan into small end-to-end issues with blocking edges, then publishes them once you approve. Runs only when asked.   |
| `domain-modeling`   | Builds a project glossary while designing: challenges fuzzy terms and records each one as it is settled.                      |
| `handoff`           | Writes a handoff document so a fresh session can continue the work. Runs only when asked.                                     |

### Code quality

| Skill                   | What it does                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `refactor-safely`       | Restructures code in small verified increments with behaviour preserved at every step.            |
| `fix-any-types`         | Replaces every `any` in a TypeScript file with a correct narrow type inferred from actual usage.  |
| `functional-typescript` | Functional patterns for TS/JS: closures, currying, immutability, composition, the module pattern. |

### Rigor and anti-slop

| Skill                                | What it does                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rigor-mode`                         | Rigorous engineering mode with 24 principles and playbooks for features, bug fixes, refactors, investigations, prototypes and finishing. Runs only when asked. |
| `unslop`                             | Cuts AI tells from prose using numbered patterns, keeping the meaning and tone.                                                                                |
| `deslop`                             | Removes AI-generated code slop from a diff: needless comments, defensive checks and style drift.                                                               |
| `no-comments`                        | Deletes comments, fixes the code that needed them, and offers to encode claimed constraints as types, tests or lint.                                           |
| `technical-writing`                  | A layered writing standard for docs, RFCs and READMEs, and for the prose of other documents.                                                                   |
| `architect`                          | Sketches types, signatures and module structure before code, then stays in the loop while the work is filled in.                                               |
| `blast-radius`                       | Finds what a change could break elsewhere and proves the one fact it is safe because of by running real code.                                                  |
| `correct`                            | Makes a mistake agents keep repeating impossible, trying architecture, then types, then lint, then tests, then docs.                                           |
| `why`                                | Answers "why does X work this way" from the commit and PR record, with citations.                                                                              |
| `tdd`                                | Fixes a bug by writing a failing test first, when asked or when a cheap local test exists.                                                                     |
| `typescript-best-practices`          | Typing, narrowing, validation and test rules for `.ts` and `.tsx` files.                                                                                       |
| `thermo-nuclear-code-quality-review` | An extremely strict maintainability review of abstraction quality, giant files and growing condition chains.                                                   |

### Project setup and CI

| Skill                            | What it does                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setup-env`                      | Generates a fillable `.env.stub` for what your local setup is missing, and checks `.gitignore` covers it.                                                                                              |
| `align-env-checklist`            | Verifies every env var the code reads is documented, validated, and that no real `.env` is tracked.                                                                                                    |
| `improve-getting-started`        | Closes the gap between what the README claims and what actually works for a new contributor.                                                                                                           |
| `guard-hooks`                    | Installs deterministic guards into Claude Code and Codex: no skipped git hooks, no staged secrets, no attribution lines, protected config and default branch, typecheck on stop. Runs only when asked. |
| `setup-commit-hooks-and-release` | Wires up Husky, commitlint, lint-staged, semantic-release, and the GitHub Actions release workflow.                                                                                                    |
| `check-ci-health`                | Inspects CI config for trigger misconfigurations, security risks, caching gaps, and slow paths.                                                                                                        |

### Dependencies and design

| Skill                  | What it does                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `upgrade-dependencies` | Plans and executes version bumps in risk-tiered batches, reading changelogs and verifying checks after each. |
| `draft-ui-redesign`    | Turns an existing page into a paste-ready prompt for a design tool. Presentation only — never changes logic. |
| `redesign-in-claude`   | Claude only. Runs `draft-ui-redesign`, then builds its prompt as a live Claude Design artifact in one run.   |

### Meta

| Skill           | What it does                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `skill-creator` | Creates, improves, and measures skills — including running eval suites and description benchmarks. |

---

## Skill structure

Each skill is a self-contained directory:

```
skills/
  {skill-name}/
    SKILL.md          # Required: frontmatter (name, description) + instructions
    references/       # Optional: deep reference docs, loaded on demand
    scripts/          # Optional: executable helpers
    evals/            # Optional: eval suite for this skill
      evals.json
      fixtures/
```

The `description` in the frontmatter is what makes a skill trigger. It carries the
trigger phrases a user would actually type and a boundary clause naming the sibling
skill to prefer when a request sits between two of them.

---

## Evals

Skills that make judgement calls carry an eval suite under `skills/{name}/evals/`.
Each eval runs twice — with the skill and without it — and the delta between the two
arms is the measurement. Ten suites exist today; the six detection skills
(`review-changes`, `review-auth`, `review-migration`, `check-query-safety`,
`audit-dependencies`, `audit-secrets`) have three evals each.

Two rules matter enough to repeat here:

- **Run every arm in a `mktemp -d` sandbox outside this repo.** Working inside the
  repo lets a baseline arm load the very skill it is supposed to be blind to.
- **Assert on what the skill adds, not on what the model already does.** An assertion
  both arms pass measures the model. `skills/review-auth/evals/evals.json` is the
  reference suite.

---

## Credits

The twelve skills in "Rigor and anti-slop" are adapted from pstack by Lauren Tan and from
Cursor's `cursor-team-kit` and `thermos` plugins, all MIT, from
[cursor/plugins](https://github.com/cursor/plugins). They are rewritten so any agent that reads
`SKILL.md` files can follow them. Each keeps its own `LICENSE.txt`. See
[`skills/UPSTREAM.md`](skills/UPSTREAM.md) for what came from where and what changed.

`grilling`, `break-into-issues`, `domain-modeling` and `handoff` are adapted from
[mattpocock/skills](https://github.com/mattpocock/skills) by Matt Pocock, MIT, as are the
deep-module reference in `architect` and the writing-for-agents reference in `technical-writing`.

---

## Contributing

Skills are written, evaluated and released from Mshindi Labs' source repo and published here
on each release, so pull requests opened here are not merged. To report a problem with a skill
or ask for a new one, open an issue.

This repo is MIT licensed (see `LICENSE`). Vendored skills (`skills/skill-creator`) keep their
original upstream license (`skills/skill-creator/LICENSE.txt`, Apache-2.0).
