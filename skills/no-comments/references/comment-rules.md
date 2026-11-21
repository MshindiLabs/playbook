# Comment rules

Brief for the comment hunt. Read the scoped files or diff. If none was given, use the current diff against the default branch, including the working tree. Find narration, banners, commented-out code and workaround explanations. Delete them.

## What stays

Only these exceptions stay.

- Legal or license headers.
- Non-obvious behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape. Surprises in our own code are not exceptions. Delete the comment and mark the exact symbol `MUST KILL` for the rename, extract, type, or rearchitecture that makes the behavior obvious without prose.
- `// prettier-ignore`. Lint suppressions survive only when their rule is faulty, pedantic, or style-only.
- Doc comments that define a public API contract.
- Issue or RFC links that explain a constraint code cannot express.
- A comment the repo's own written rules require. It stays. Where it guards a suppression (`!`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`), still report the suppression as a candidate for a real fix.

That list is the whole rule. When you are not sure a keep clause applies, delete the comment. Everything else goes.

## Suppressions

`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, and similar suppressions are suspect. Look up the rule. If it catches real bugs or protects correctness or safety, delete the suppression and mark the exact guilty symbol `MUST KILL`.

## Claims to verify

`IMPORTANT`, `do not remove`, `too risky`, `fine for now`, and long justifications are signals, not proof. Before judging, read nearby code. If its claim is not obvious there, trace the named symbol or call, run the `why` skill on it, or both. Only a keep-list gotcha about something foreign, proven true today on a live path, stays. Surprises in our own code are deleted with the reshape flag above. Doubt after the check means delete.

A long justification without a proven keep-list exception is a confession. Delete it. Never shorten it into a smaller excuse. Mark the exact guilty symbol `MUST KILL`. The deletion is the end of the job: do not touch the code.

## Limits

Every flag names code inside the scope and states what is true. Invent nothing. Touch comments only and identify refactor targets. Never write application code.

## Report

Report only. Name the touched files, the deletion count, the `MUST KILL` flags with one line each, and the skips.
