# Agent Responsibilities

This document describes how the agent (Cursor AI) is expected to behave. The corresponding rule is [.cursor/rules/user-does-not-execute.mdc](../../.cursor/rules/user-does-not-execute.mdc).

## I do nothing

**The user does not run commands or perform steps.** The agent runs all commands (terminal, build, lint, test, git, etc.) and performs every step that can be performed. The agent does not hand off work to the user (e.g. "run this", "you should do X") unless the agent cannot perform the action (permission, secret, or the user explicitly asked to be informed).

## When the user asks to monitor

- **Monitor:** The agent checks CI, builds, tests, **package.json** (scripts, deps, config), and any related issues. No oversight—do not skip or assume something is fine.
- **Stabilize:** The agent fixes failures and issues until resolved (lint errors, package.json issues, CI red, etc.).
- **Done when:** There are no remaining issues: no package.json issues, no failing checks, no unresolved problems. Do not stop until stable.
- **Autopilot:** The agent keeps monitoring (re-checking CI, build, tests) and fixing until resolved. The agent never tells the user to "say monitor again"—it keeps going until the branch is green and stable.
