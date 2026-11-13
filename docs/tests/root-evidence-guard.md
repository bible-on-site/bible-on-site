# Repository-root evidence gate

Validation evidence (screenshots, captures, recordings) is published
through pull-request descriptions/comments, issue attachments, CI
artifacts or commit permalinks — never through a tracked
repository-root `evidence/` directory
([#3319](https://github.com/bible-on-site/bible-on-site/issues/3319),
cleanup follow-up to [#2917](https://github.com/bible-on-site/bible-on-site/issues/2917)
and [#3055](https://github.com/bible-on-site/bible-on-site/pull/3055)).

The independent **Root evidence guard** CI job runs
[devops/github/ci/root-evidence-guard.mjs](../../devops/github/ci/root-evidence-guard.mjs)
on every pull request, push to master and merge-group run, with no
module-change or build prerequisites — an evidence-only change still
fails it. The gate scans the git index of the checked-out tree and fails
on any tracked path that is exactly `evidence` or under `evidence/` at
the repository root — arbitrary extensions, nesting, hidden filenames,
force-added paths and root files/symlinks named `evidence` alike. It
also requires the root `.gitignore` `/evidence/` anchor to stay in place
as first-line protection. Cross Module CI requires this job to succeed.

Scope is the root path only: module-scoped evidence such as
`docs/evidence/` and per-suite coverage/e2e evidence remain allowed.

Run the same checks locally from `devops`:

```sh
bun run test:root-evidence-guard
bun run verify:root-evidence-guard
```

A failure prints each offending tracked path. Remove it from the index
with `git rm -r evidence` (`-r --cached` keeps the local files) and
publish the evidence through the channels above instead.
