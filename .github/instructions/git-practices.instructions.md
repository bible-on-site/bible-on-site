---
description: "Pre-commit, commit process, branch management, and PR practices"
applyTo: "**"
---

# Git Practices

## Pre-commit

Config `.pre-commit-config.yaml`; venv `devops/.venv/`; tool config `devops/pyproject.toml`; Husky runs it via `.husky/pre-commit`. When adding a hook, also update `docs/devops/pre-commit.md`.

## Task Boundary Workdir Gate

**MANDATORY**: never begin or finish a task with untriaged dirt.

Run `git status --short` before implementing and again before reporting done, and put every dirty file in exactly one bucket:

- **In-scope** — keep and continue.
- **Intentional out-of-scope user work** — isolate in its own commit/branch/stash; never mix it into the current task.
- **Generated/temporary noise** — remove or revert immediately.

If ownership or intent is unclear, stop and ask. Do not start coding, and do not mark the task complete, while unclassified dirt remains.

## Clean Working Directory Before Commit

Inspect **all** modified, staged, and untracked files (`git status`, `git diff`) and decide per change, regardless of origin: correct → stage and commit it (separately when unrelated to the task); wrong → discard it (`git checkout -- <file>`, or delete untracked artifacts). Build artifacts, test outputs, and temp files (`test_stdout.txt`, `*.zip`, extracted directories) go unless they are intentional project assets. Nothing may be left both uncommitted and undiscarded.

## Commit Process

1. Review staged changes for PII (AWS IDs, API keys, passwords, emails): `git diff --cached`.
2. Commit, then **always** run `git status` — pre-commit hooks often auto-fix files.
3. If files changed, restage and amend, repeating until the tree is clean:
   `git diff-tree --no-commit-id --name-only -r HEAD | xargs git add && git commit --amend --no-edit`
4. Push only from a clean tree.

You run every git command yourself; never hand git (or AWS/docker/npm) commands to the user.

## Branch Management

- **Never clone** the repository to do work — reuse this checkout and create a branch per feature/fix.
- Use **worktrees only when explicitly asked**, and clean them up after merge (`git worktree remove <path>` + `git worktree prune`).
- Before pushing, check whether the branch already exists on remote (`git ls-remote --heads origin <branch-name>`): if it exists and was merged, use a new name; otherwise fetch and rebase first.

## Pre-Push: Merge From Master

**MANDATORY** before every push: `git fetch origin master && git merge origin/master`. Resolve any conflict immediately — inspect each file, apply the correct resolution (preserving both sides where appropriate), stage it, and complete the merge. Push only with a clean tree.

## Post-Push: Monitor CI

**MANDATORY** after every push: wait 10–20s, then `gh run list --branch <branch-name> --limit 3`, polling every 30–60s until it completes. On failure, inspect (`gh run view <run-id> --log-failed`), fix the root cause locally, and push again (repeating the master merge). Report the final observed status.

## Ship It — A Local Fix Is Not A Fix

**Work that exists only in this checkout is not done.** Every fix, upgrade, and rule change is committed, pushed, and carried through its PR to merge in the same task — you are not fixing things for yourself.

- Never end a task with committed-but-unpushed or uncommitted work, and never leave a branch published but unmerged, unless the user asked for review first or a hard blocker stops the merge.
- "It works locally" is a checkpoint, not a deliverable: push, get CI green, triage review comments, merge, and verify the post-merge state.
- Local-only validation is required _before_ pushing (see [agent-practices.instructions.md](agent-practices.instructions.md)); it never replaces pushing.

## Pull Requests

- One branch per feature/fix; the PR is created when the branch is published.
- The Auto Create PR workflow normally opens the PR after the first push — wait for it and locate the PR by head branch before calling `gh pr create`, or PR creation collides.
- **You own the repo end-to-end and merge PRs yourself** once required checks are green and every review comment is triaged. Surface only plans and expensive/hard-to-reverse decisions for approval first (prod RDS/schema deploys, destructive infra, anything hard to reverse); do not wait for a human to merge routine work.

## Merge Queue

- Source of truth is GraphQL `mergeQueueEntry { position state }` plus final PR `state`/`mergedAt`. `autoMergeRequest: null`, `mergeStateStatus: UNKNOWN`, or `mergeable: UNKNOWN` does not prove a PR left the queue.
- `gh pr merge`'s notice that the merge queue controls the strategy is not a failure — confirm the resulting queue entry.
- Track the current `merge_group` run and its head SHA; a green pull-request run is not evidence that the merge-group run passed.
- Refresh PR state immediately before editing, pushing, enqueueing, or commenting — a queued PR can merge mid-investigation.
- To stop a queued PR, dequeue it with the GraphQL `dequeuePullRequest` mutation; disabling auto-merge alone does not remove an active entry.
- Code-scanning review threads cannot be resolved manually: fix the alert, wait for CodeQL to mark it fixed/outdated, then recheck merge readiness.
- Before declaring all open work consolidated, list every non-draft open PR and account for each one explicitly.

## Review Comment Triage (MANDATORY before every merge)

**Never merge or enqueue a PR without triaging every review comment** (Copilot, Codacy, human, any reviewer), even with all checks green. Repeat every review round, including comments from Renovate/master-merge churn.

1. Fetch `gh api repos/<owner>/<repo>/pulls/<n>/reviews --paginate`, `.../pulls/<n>/comments --paginate`, `.../issues/<n>/comments --paginate`.
2. Re-read the flagged file's current on-disk state — a later commit may already have resolved it — then give each comment exactly one disposition:
   - **Embrace** — fix on the branch, re-validate (tests/lint/build), commit, push. Verify the exact changed bytes, commit, and pushed SHA before replying "resolved"; a passing formatter or test does not prove the change was made.
   - **Defer** — valid but out of scope: file a tracked issue per [github-issues.instructions.md](github-issues.instructions.md) (Priority + Difficulty + Type + Component labels, on the relevant board) and reference it.
   - **Dismiss** — invalid or not applicable: state the reasoning (correctness, severity, priority).
3. Post the triage summary as a PR comment (`gh pr comment <n> --body-file <file>`) — the durable record, not a repo file — delete the local scratch file, then merge or re-enqueue.
