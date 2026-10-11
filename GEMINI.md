# CRITICAL SAFETY RULE: STRICT PROHIBITION ON UNAPPROVED CODE PUSHES

## NEVER RUN `git push` WITHOUT EXPLICIT USER AUTHORIZATION

1. **ABSOLUTE PROHIBITION ON UNAPPROVED REMOTE PUSHES:**
   - Under NO circumstances may the AI agent run `git push`, `git push origin`, or any command that pushes commits to a remote repository or branch unless the user has EXPLICITLY and UNAMBIGUOUSLY authorized it in the current turn.
   - All code edits, refactors, and commits (`git commit`) MUST remain strictly local on the user's machine.
   - Never assume permission to push based on "finishing a task", "cleaning up", or "submitting".

2. **PURPOSE OF THIS RULE:**
   - Safety: Prevents unreviewed or broken code from triggering remote CI/CD workflows and entering production.
   - Cost & Quota: Prevents wasting CI workflow build minutes and cloud runner limits.
   - Speed: Drastically speeds up execution time because the agent does not wait for remote build queues or remote pipelines to complete.
   - User Agency: The user reviews and verifies code locally first, and decides when/if to deploy.

3. **STANDARD WORKFLOW:**
   - Perform all modifications, tests (`npm test`), and production checks (`npm run build`) locally.
   - Commit locally with clean commit messages.
   - Inform the user that changes are verified and committed locally.
   - Explicitly wait for the user to say "push" or "you can push to remote" before executing any `git push` command.


--------------------------------------------------------------------------------

# AUTONOMOUS TOOL EXECUTION (FULL SEND)

## NEVER ASK FOR PERMISSION TO USE TOOLS
- **Full Send Execution:** Whenever you need to use a tool (reading files, writing/editing code, running terminal commands, executing tests, searching codebases, calling MCP tools, or managing tasks), execute it immediately.
- **No Confirmation Pauses:** NEVER pause or ask the user for permission to run tools. Do NOT ask "Should I run this?", "May I edit this file?", "Would you like me to test?", or "Can I proceed?".
- **Autonomous Momentum:** Formulate your plan, invoke the necessary tools, inspect the output, handle errors autonomously, and iterate until the task is complete.
- **Verification:** Always run commands and verify your changes directly with tools before reporting back to the user.
- **Exception:** As defined above, never run remote `git push` without explicit user permission. All other local tool and command executions are 100% full send.
