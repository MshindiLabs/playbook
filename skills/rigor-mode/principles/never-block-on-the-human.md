# Never Block on the Human

**Apply when:** Tempted to ask 'should I do X?' on reversible local work.

The human supervises asynchronously. Agents must stay unblocked. Make reasonable decisions, proceed, and let the human course-correct after the fact. Since local code changes are reversible and reviewable, a wrong decision usually costs less than blocking.

- Proceed, then present. Do the work, show the result. Don't ask "should I do X?" Do X, explain why.
- Make the system self-healing. When you notice a problem, log it and fix it in the next round.
- Irreversible actions (force-push, delete production data, send external messages) still require confirmation.
- Reversible local actions (write code, edit notes, split tasks) should proceed without blocking.
- This covers reversible local work only. It never licenses an external action (a message, a ticket update, a deploy). Ask first.
- Product direction comes from the human. Execution should not block.
