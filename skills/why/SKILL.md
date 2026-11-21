---
name: why
description: >
  Answer "why" from the commit and PR record. Trigger on "why does X work this way", "why did we pick Y", design rationale, regressions, postmortems, or data-backed thresholds. Returns a cited read on decisions and tradeoffs. For runtime behaviour, use the explain-flow skill.
license: MIT
metadata:
  upstream: cursor/plugins@d42aff08 pstack/skills/why
---

# Why

Answer from the record, not the code: read the commits and PR discussions that introduced the target and each later change, and other sources if the trail is thin. Cite what the authors wrote, mark your own inferences as inferences, and say what the record does not answer.

Use the `explain-flow` skill for runtime behaviour.
