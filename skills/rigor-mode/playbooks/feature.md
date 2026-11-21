### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Trace the affected subsystem. Plan the change with the `plan-change` skill.
2. The `architect` skill for the shape.
3. Write the throughput checkpoint as four items in your agent's task list, if it has one, or in your plan. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target ([separate before serializing shared state](../principles/separate-before-serializing-shared-state.md)). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing with a specific scope: file paths, the named data shape and its organizing structure per [model the domain](../principles/model-the-domain.md) (a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic), and success criteria. Delegate to a subagent if your agent has them, with this brief. Without subagents, do the step yourself as a separate pass. Brief it per the Delegation section of [the skill file](../SKILL.md). When the implementation admits more than one shape (error handling, abstraction layer, test structure), sketch two shapes with the `architect` skill and pick one before delegating. No "standing by" reply that waits on a nested agent. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. Drive the real surface with the browser or terminal tooling your agent has. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use [sequence work into verifiable units](../principles/sequence-verifiable-units.md), building, verifying, and committing each small unit before the next.
7. If the design is contested, run the `thermo-nuclear-code-quality-review` skill for structure and the `review-changes` skill for risk before shipping.
8. Run [finishing](finishing.md).

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
