---
description: "Agent does the work; user does not run build/copy/commands. Covers error suppression policy, local reproduction, monitoring, and ownership."
applyTo: "**"
---

# Agent Practices

Execution ownership is defined in [user-does-not-execute.instructions.md](user-does-not-execute.instructions.md): you run every command and finish every ask in the same turn. This file adds the repo-specific gates.

- Flip book: build in `html-flip-book`, then run `USE_LOCAL_FLIP_BOOK=1 npm run postinstall` in the website. CI/production use the published npm package, not the `file:` dependency.

# Workdir Cleanliness Gate

See [git-practices.instructions.md](git-practices.instructions.md#task-boundary-workdir-gate): `git status --short` before implementing and before reporting done, every dirty file triaged as in-scope, isolated user work, or noise.

# No Suppressing Errors Without Approval

**Never silence an error or warning to make CI pass** — no `--ignore-errors`, `continue-on-error`, `|| true`, empty `catch {}`, downgraded severities, skipped tests, or disabled lint rules. Fix the root cause. If a proper fix is genuinely out of scope, get approval first and state exactly what is being suppressed and why.

```
# BAD - suppressing to make CI green
lcov --ignore-errors inconsistent,corrupt ...
continue-on-error: true

# GOOD - fix the root cause
# Normalize the coverage data so it's consistent before merging
```

# Reproduce Locally Before Remote Iteration

Reproduce failures locally (tests, builds, linters, Docker builds, coverage merges), iterate until they pass, then push once. Never use remote CI as a trial-and-error loop. Only CI-only infrastructure (secrets, cloud services, runner environments) justifies remote iteration — and then minimize round-trips.

# Own Your Work

Everything in this codebase was written by you; there is no other developer. Never call your own code "pre-existing" or "already there" — say "I added / I introduced this bug" and fix regressions, side effects, and design mistakes without deflecting.
