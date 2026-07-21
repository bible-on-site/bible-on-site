---
description: "Pre-commit, commit process, branch management, and PR practices"
applyTo: "**"
---

# Git Practices

## Pre-commit

- Config: `.pre-commit-config.yaml`; venv: `devops/.venv/`; tool config: `devops/pyproject.toml`.
- Husky runs pre-commit via `.husky/pre-commit`.
- Adding a hook: add to `.pre-commit-config.yaml`, then update `docs/devops/pre-commit.md`.

## Task Boundary Workdir Gate

**MANDATORY**: Do not start a task and do not finish a task while the workdir is dirty unless every dirty file has been explicitly triaged and handled.

### Start gate (before implementation)

1. Run `git status --short` and inspect all modified/staged/untracked files.
2. Classify every dirty file into exactly one bucket:
   - **In-scope for the current task**
   - **Intentional out-of-scope user work**
   - **Generated/temporary noise**
3. Act on each bucket before writing code:
   - **In-scope**: keep and continue.
   - **Intentional out-of-scope**: isolate (separate commit/branch/stash) and do not mix with current task. If ownership or intent is unclear, stop and ask.
   - **Generated/temporary noise**: remove/revert immediately.
4. Do not begin implementation until no unclassified dirt remains.

### Finish gate (before reporting done)

1. Run `git status --short` again.
2. Re-triage any remaining dirt with the same buckets above.
3. Resolve all remaining dirt by commit, isolation, or cleanup.
4. Do not mark task complete while unresolved/unclassified changes remain.

## Clean Working Directory Before Commit

**MANDATORY**: Before every commit, the agent MUST ensure the working directory is clean of unrelated changes:

1. Run `git status` and `git diff` to inspect **all** modified, staged, and untracked files.
2. For each change, decide: **is this change correct and acceptable?** (regardless of who wrote it or when it appeared).
   - **If yes** — stage it and include it in the commit (or a separate commit if it's unrelated to the current task).
   - **If no** — discard it (`git checkout -- <file>` for tracked files, `rm` for untracked artifacts).
3. Never leave stray changes in the working directory. Every file must be either committed or discarded before proceeding to the next task.
4. Untracked build artifacts, test outputs, and temporary files (e.g. `test_stdout.txt`, `*.zip`, extracted directories) should be removed unless they are intentional project assets.

## Commit Process

1. **Before commit**: Review staged changes for PII (AWS IDs, API keys, passwords, emails). Use `git diff --cached`.
2. After `git commit`, pre-commit may auto-fix; check `git status`.
3. If files were auto-fixed, stage and amend:
   `git diff-tree --no-commit-id --name-only -r HEAD | xargs git add && git commit --amend --no-edit`
4. Push only when the working tree is clean.

**Agents**:
- **MANDATORY**: After every `git commit`, you MUST run `git status` and inspect the output. If the working tree is not clean (pre-commit hooks often auto-fix files), stage all changed files and amend: `git diff-tree --no-commit-id --name-only -r HEAD | xargs git add && git commit --amend --no-edit`. Repeat until the working tree is clean.
- When you make changes that should be committed, **you** commit and push—do not tell the user to run git commands.
- **NEVER** tell the user to run commands. You execute all commands yourself using the shell tool. This includes git commands, AWS CLI, docker, npm scripts, and any other CLI operations.

## Branch Management

Before pushing, check if the branch already exists on remote (may be merged/deleted):

```bash
git ls-remote --heads origin <branch-name>
```

If it exists: check if merged; if merged, use a new branch name; if not, fetch and rebase before pushing.

## Pre-Push: Merge from Master

**MANDATORY before every push**, the agent MUST:

1. Fetch and merge the latest `master` into the current branch:
   ```bash
   git fetch origin master
   git merge origin/master
   ```
2. If there are merge conflicts, **resolve them immediately** — inspect each conflicting file, apply the correct resolution (preserving both sides where appropriate), stage the resolved files, and complete the merge commit.
3. Only push after the merge is clean and the working tree has no conflicts or uncommitted changes.

## Post-Push: Monitor CI

**MANDATORY after every push**, the agent MUST:

1. Wait briefly (10–20 seconds), then check the CI status of the pushed commit/branch:
   ```bash
   gh run list --branch <branch-name> --limit 3
   ```
2. If a run is in progress, poll periodically (every 30–60 seconds) until it completes or the user intervenes.
3. If CI fails, inspect the failure (`gh run view <run-id> --log-failed`), diagnose the root cause, fix it locally, and push again (repeating the merge-from-master step).
4. Report the final CI status to the user.

## Pull Requests

- Use a new branch per feature/fix. PR is created when publishing the branch.
- Only @DoradSoft can merge unless explicitly delegated.

## Review Comment Triage (MANDATORY before every merge)

**Never merge or enqueue a PR (`gh pr merge`, enabling auto-merge, or adding to the merge queue) without first triaging every review comment — from GitHub Copilot, Codacy, human reviewers, or any other reviewer — even if CI/coverage/version gates are all green.**

1. Fetch all reviews, line comments, and general PR conversation comments before merging/re-merging:
   ```bash
   gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate
   gh api repos/<owner>/<repo>/pulls/<n>/comments --paginate
   gh api repos/<owner>/<repo>/issues/<n>/comments --paginate
   ```
2. For every distinct comment, explicitly decide one of:
   - **Embrace**: the comment is correct and should block/improve this PR — fix it directly on the branch, re-validate (tests/lint/build), commit, and push.
   - **Defer**: the comment is valid but out of scope for this PR — file a tracked GitHub issue per [github-issues.instructions.md](github-issues.instructions.md) (Priority + Difficulty + Type + Component labels, added to the relevant project board) and reference it in the triage summary.
   - **Dismiss**: the comment is invalid or not applicable — state the reasoning explicitly (based on correctness, severity, and priority).
3. Before deciding, re-read the current on-disk state of any flagged file — a comment may already be resolved by a later commit.
4. Post a triage summary as a PR comment (`gh pr comment <n> --body-file <file>`) listing every comment's disposition, then delete any local scratch file used to draft it — the PR comment is the durable record, not a repo file.
5. Only after every comment has been triaged (and any embraced fixes pushed and green) may the PR be merged or re-enqueued.

This applies to every review round — if new comments appear after a later push (e.g. from Renovate/master-merge churn), repeat the triage before merging again.

