# Module Version Bumps

Module versions are never bumped in pull requests. PR and merge-queue checks validate
the proposed code without requiring a version change.

After a module releases from `master`, the `Bump Versions` job increments its version
on `master`, including the website. The bump is pushed with `[skip ci]`, so master
normally holds the next unreleased version and the next merge can release it directly.
The app build-number consistency check in `devops/check-app-version.py` remains active.

If a release tag already exists but belongs to another commit, the release job warns,
skips tag creation and release, and sets `needs_bump`. The master bump job then increments
that module together with other required bumps, without `[skip ci]`. That push starts a
new CI run for the bumped module, which can package and release its new version. The
release workflow dispatches CD only for the exact tag commit, so retry runs do not deploy
the colliding release.

Hosted Renovate needs no version-bump configuration. It updates dependencies normally;
module version bumps happen only after releases on `master`.

## Concurrent releases and deployment

CI packages an immutable commit, creates its module tag and GitHub Release, and
dispatches CD with that commit and CI run ID. Deployment also requires that source run's
`Cross Module CI` to have passed. The master version bump follows the
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
version tag: a newer successful `Release Data` job or durable successful data deployment
supersedes older SQL dispatches, including when the newer CI is subsequently rerun.
Data checkout also uses the dispatching commit SHA, so its migration scripts and
SQL artifact come from the same CI run. API failures stop deployment.

## Recovery

A release is a draft until all required assets are uploaded and verified by name,
size and the GitHub SHA-256 digest when available. Missing files, partial uploads
and API failures stop publication and CD. Rerun the failed CI jobs to finish a tag-only
or draft release. Draft recovery uses the current passing CI build of the exact tag commit and
updates its delivery metadata. Downloads pin immutable archive IDs and verify
their SHA-256 checksums. Published assets are never replaced by a rerun.

Versioned CD downloads the published GitHub Release assets, not mutable CI artifacts:
a full CI rerun may rebuild the same artifact name, but cannot change the binary CD
uses. Release notes retain the exact source SHA, CI run ID, version and dispatch
payload. Rerunning a completed release replays that payload and finishes any missed
version bump. Legacy releases without this metadata advance the version on recovery
but do not automatically replay a dispatch.

Each CD target records its attempt and completion in GitHub Deployments. Repeated
successful deliveries skip production writes. App completion is separate for Android,
Windows and iOS, so rerunning a failed platform does not upload the successful platforms
again. Failed or interrupted attempts remain visible and retryable. This is completion
tracking, not a distributed transaction with the stores: if a runner or status write
fails after a store accepts an upload, inspect the store's version/build before retrying.

Normal bumps and collision retries publish together, with CI enabled only when an
unreleased collision actually needs packaging. Later collision requests reuse a retry
commit that already contains their source, preventing duplicate master builds. If that
retry CI fails, repair it and rerun its failed jobs; further collision requests do not
hide the failed run by continuously increasing versions.

For a failed dispatch, rerun the failed dispatch job or the release workflow. For a failed
CD, rerun failed jobs in that CD workflow. Queues retain at most 100 pending jobs; overflow,
manual cancellation, expired CI artifacts during draft recovery, and exhausted five-attempt
bump publication retries still require explicit recovery from the visible failed/cancelled
run. The workflow never force-pushes master or rolls production back automatically.

## CI reruns and SQL archive identity

Published release metadata records the original CI run and attempt. CD verifies the latest Cross Module CI result at or before that attempt, so a failed full rerun cannot invalidate already published binaries. A failed-jobs-only rerun can reuse its unchanged successful quality gate. A newer failed quality gate never inherits an earlier pass.

Data dispatches carry an immutable SQL artifact ID, SHA-256 archive digest, commit SHA, and CI attempt. CD verifies the archive's source, expiry, and checksum before accessing production. Data completion records include that artifact ID, allowing a new archive from a CI rerun to deploy while repeated dispatches of a completed archive are skipped. Successfully deployed later attempts also prevent older SQL from replacing them.

Legacy data dispatches without an artifact ID are bound once to a verified archive only if the source CI has never been rerun. After a rerun, their original SQL cannot be proven: use the new Release Data dispatch with an immutable artifact ID. Completed pinned SQL deliveries remain no-ops after archive expiry. Incomplete deliveries with deleted or expired archives fail visibly; they never fall back to replacement SQL.


## Handover from older workflows

An older master `bump_versions` job checks out current master but invokes separate
released/retry CLI steps. The publisher recognizes only that existing master push
job and handles both modes together with safe retries. It emits no edit summary,
so the older workflow skips its commit/rebase/push steps. Other callers retain
file-only behavior unless they explicitly request publishing.

Before merging this change, drain any production CD runs and version-bump jobs
already running with older code. To recover a historical CD failure after the handover, issue a fresh dispatch
from a current master release workflow so the new guards execute. Rerunning an old
CD run reuses its historical workflow code and does not acquire these new guards.
