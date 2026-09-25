---
trigger: always_on
description: Strict safety rule prohibiting any git push commands without explicit user authorization.
---

# STRICT SAFETY RULE: NEVER RUN `git push` WITHOUT USER AUTHORIZATION

1. **NO CODE PUSHING WITHOUT DIRECT PERMISSION:**
   - The AI agent is strictly forbidden from executing `git push` (or any variant pushing to remotes) without explicit, affirmative authorization from the user in that specific turn.
   - All code edits, refactors, and commits (`git commit`) must stay strictly local on the development machine.

2. **WHY THIS RULE IS ACTIVE:**
   - Protects production against unreviewed code.
   - Prevents unneeded CI/CD workflows and actions from executing.
   - Speeds up responses by removing wait times for remote build pipelines.
   - Ensures user retains complete control over code deployment.

3. **PROTOCOL:**
   - Keep everything local.
   - Verify locally with `npm test` and `npm run build`.
   - Once work is complete, report the status to the user and wait for their explicit command before pushing.
