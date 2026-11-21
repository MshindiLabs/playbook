### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix to subagents, stay in the lead. Delegate to a subagent if your agent has them, with the scope each step below gives. Without subagents, do the step yourself as a separate pass. Brief each one per the Delegation section of [the skill file](../SKILL.md).

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the matching surface. Drive the real surface with the browser or terminal tooling your agent has, even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason that tooling cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause, using the `debug-issue` skill for the hunt. Form the candidate hypotheses, then rule them out until one survives. Seed them with a trace of the affected subsystem and the `why` skill for regression history. Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. Confirm the surviving _mechanism_ with runtime evidence before step 3's `architect` skill or a review of the design with the `thermo-nuclear-code-quality-review` skill and the `review-changes` skill.
3. Plan the fix. If it crosses a function boundary, the `architect` skill first. Delegate implementation with a specific scope.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. See the `tdd` skill for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical case of [sequence work into verifiable units](../principles/sequence-verifiable-units.md), the failing test first and the fix on top.
6. Run [finishing](finishing.md).

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
