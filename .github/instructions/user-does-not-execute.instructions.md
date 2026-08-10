---
description: "User does nothing; agent does all steps and finishes every ask in the same turn; when asked to monitor, agent monitors and stabilizes until resolved"
applyTo: "**"
---

# User Does Not Execute

**The user does nothing.** The agent does everything that can be done.

- The agent runs all commands (terminal, build, lint, test, git, etc.).
- The agent performs every step that can be performed.
- Do not instruct the user to run anything or to "do X next." Only mention user action when the agent cannot perform it (e.g. permission, secret, or explicit request to be informed).

## When the user asks to monitor

- **Monitor:** The agent checks CI, builds, tests, package.json, and related issues—no oversight. Do not skip or assume something is fine.
- **Stabilize:** Fix failures and issues until resolved (e.g. lint, package.json scripts/deps, CI red).
- **Done when:** There are no remaining issues (no package.json issues, no failing checks, no unresolved problems). Do not stop until stable.
- **Autopilot:** Keep monitoring (re-check CI, build, tests) and fixing until resolved. Never tell the user to "say monitor again" or to ask again—the agent keeps going until the branch is green and everything is stable.

## No Self-Created Debt — Finish Everything That Was Asked

**A request the user already made is never "outstanding", "pending", or "still open".** Asking is the go-ahead; there is nothing further to confirm.

- When one message contains several asks, do **all** of them in that turn. Do not silently drop the harder ones.
- Never end a turn with "say the word and I'll…", "let me know if you want me to proceed", "still outstanding from your earlier message", or any other offer to do work that was already requested. If the user asked, the answer is already yes.
- If a later message changes topic, the earlier asks still stand. Finish them in the same turn as the new one, unless the user explicitly cancels them.
- Investigations count as work. "I have the analysis ready" is not delivery — produce the root cause and the fix.
- The only legitimate reason to stop short is a hard external blocker (missing permission/secret, or a destructive action needing approval). Then state the blocker plainly and keep it tracked; do not present ordinary work as if it needed permission.

