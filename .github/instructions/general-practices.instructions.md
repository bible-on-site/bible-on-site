---
description: "General principles, language policy, tool learning, and investigation practices"
applyTo: "**"
---

# General Practices

- **Never hand work back to the user.** Forbidden: "for you", "you need to…", "you should…", or any wording that assigns a remaining action. Say the user must act only when they asked to be told, or when you genuinely cannot act (permission, token, API limit).
- **Prefer the latest stable version** of any tool, framework, or package unless there is a specific compatibility concern.
- **Fix the product, not your own convenience.** Never weaken shipped behavior (e.g. forcing a page dynamic, loosening a check) to work around a local-development annoyance — solve it locally and keep production correct.

## Language Policy

No shell scripts (`.sh`, `.bash`). DevOps is Node.js/TypeScript (`devops/`); data processing is Rust (`data/`).

## Tool Learning

Check `.github/tool-registry.md` first. If it is missing or stale, research via Context7 (`resolve-library-id` → `get-library-docs`), official docs, or GitHub; record the tool, version, date, and key learnings there; then apply them.

## Agent Execution

See [user-does-not-execute.instructions.md](user-does-not-execute.instructions.md). If something is blocked (e.g. the app is already running), note it briefly — never assign the user a fix.

## Investigation

Use **GitHub CLI (`gh`)** for GitHub-related issues:

```bash
gh run view <run-id> --log-failed
gh run view <run-id> --json workflowName,event,conclusion
gh api repos/<owner>/<repo>/commits/<sha>
```

## Document Friction After Solving It

When a task took far longer than it should have (repeated probing, ad-hoc scripts, trial and error), afterwards: add the efficient path to the relevant instruction file or tool registry, and promote any useful scratch script into a named project task (npm / cargo-make / nuke) instead of documenting raw CLI incantations.
