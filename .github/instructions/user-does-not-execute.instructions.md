---
description: "User does nothing; agent does all steps and finishes every ask in the same turn; when asked to monitor, agent monitors and stabilizes until resolved"
applyTo: "**"
---

# User Does Not Execute

**The user does nothing.** The agent runs every command (terminal, build, lint, test, git) and performs every step it can. Mention user action only when the agent cannot act (permission, secret) or when the user asked to be informed.

## When the user asks to monitor

Check CI, builds, tests, package.json, and related issues without skipping or assuming anything is fine; fix what is broken and keep re-checking until nothing is left failing. Never tell the user to ask again — keep going until the branch is green and stable.

## No Self-Created Debt — Finish Everything That Was Asked

**A request the user already made is never "outstanding", "pending", or "still open".** Asking is the go-ahead.

- Do **all** asks in a message in that same turn, including the hard ones.
- Never end with "say the word and I'll…", "let me know if you want me to proceed", or "still outstanding from your earlier message". The answer is already yes.
- A later message does not cancel earlier asks; finish them in the same turn unless the user explicitly cancels them.
- Investigations are work: deliver the root cause and the fix, not "I have the analysis ready".
- A fix is delivered when it is pushed and merged, not when it works locally — see [git-practices.instructions.md](git-practices.instructions.md#ship-it--a-local-fix-is-not-a-fix).
- Stop short only for a hard external blocker (missing permission/secret, or a destructive action needing approval) — state it plainly and keep it tracked.
