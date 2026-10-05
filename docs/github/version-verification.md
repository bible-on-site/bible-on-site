# Module Version Bumps

Module versions are never bumped in pull requests. PR and merge-queue checks validate
the proposed code without requiring a version change.

After a module releases from `master`, the `Bump Versions` job increments its version
on `master`, including the website. The bump is pushed with `[skip ci]`, so master
normally holds the next unreleased version and the next merge can release it directly.
The app build-number consistency check in `devops/check-app-version.py` remains active.

If a release tag already exists but belongs to another commit, the release job warns,
skips tag creation and release, and sets `needs_bump`. The master bump job then increments
that module and pushes a separate retry commit without `[skip ci]`. That push starts a
new CI run for the bumped module, which can package and release its new version. The
release workflow only dispatches CD when it created the tag, so retry runs do not deploy
the colliding release.

Hosted Renovate needs no version-bump configuration. It updates dependencies normally;
module version bumps happen only after releases on `master`.

## Concurrent releases and deployment

CI packages an immutable commit, creates its module tag and GitHub Release, and
dispatches CD with that commit and CI run ID. The master version bump follows the
release/dispatch; CD can still be running when the bump is pushed. CD never builds
from the bump commit or reads the next version from the moving master branch.

Release jobs queue per module, master bumps queue repository-wide, and CD queues
per production target with `cancel-in-progress: false` and `queue: max`. GitHub's
default single pending slot would otherwise cancel an older waiting job even with
`cancel-in-progress: false`. The maximum queue retains up to 100 pending jobs;
queue arrival order is not commit order. See
[GitHub concurrency syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

Each bump publication fetches master and tags, calculates its edits from that
head, and pushes without force. If another merge wins the push, it discards only
its own disposable CI bump commit and recalculates against the new master instead
of rebasing stale version edits. Authentication/policy failures remain failures.
Late collision retries skip a module when its latest tag already contains their
source commit. Normal release bumps remain idempotent and retain `[skip ci]`;
collision retry pushes run CI.

Inside the CD queue, a guard verifies the artifact's CI run, source SHA and release
tag. A newer published version supersedes an older queued dispatch. Data has no
version tag: a newer successful `Release Data` job supersedes older SQL dispatches.
Data checkout also uses the dispatching commit SHA, so its migration scripts and
SQL artifact come from the same CI run. API failures stop deployment.

An exact-tag-commit rerun can finish a tag-only release interrupted before GitHub
Release creation. A published release keeps its original artifacts; retry a failed
CD dispatch by rerunning its failed job, or retry the CD workflow itself. Missing
artifacts or unmatched release files fail the release job; ancestor runs and
commits colliding with another tag never replace that release.
