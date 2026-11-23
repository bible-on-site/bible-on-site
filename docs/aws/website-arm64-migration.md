# Website ARM64 migration

Production website tasks run ARM64 on Fargate. The website ECR EventBridge
rule deploys `bible-on-site:latest`. The current service and capacity settings
are in the [AWS architecture guide](architecture/aws-architecture.md).

## Production readiness

The website task definition checks `/api/health/ready`, `/api/recitation`, and
`/api/recitation/2`, each with a three-second curl limit within the 10-second
health timeout. This warms the critical routes before the task is eligible to
receive public traffic.

## Native build and release contract

Both native runners build the same website Dockerfile and source version.
Architecture-specific Bun caches and per-architecture dependency-cache
artifacts (`website-deps-cache.master.amd64` and
`website-deps-cache.master.arm64`) prevent cross-architecture cache reuse.
The final standalone runner executes an actual sharp/libvips
JPEG encode, resize and decode before the image can be published. Its Node
architecture must match the build target. This supplements the existing native
SWC/libvips dependency check.

Trusted repository PRs and merge groups run the full paired SSG release builds,
including the existing production-content and recitation/playback verifiers at
the deployed CPU/memory limits. Owned temporary RDS build access is cleaned up
on success or failure. Fork PRs cannot receive production secrets and keep the
existing credential-free architecture validation. Triggered packaging failures,
cancellations, skipped builds and empty/mismatched versions block the quality
gate. Published releases consume only their original master push artifacts.

The amd64 archive retains its existing name:
`bible-on-site-v<version>.tar.gz`. ARM adds
`bible-on-site-v<version>-arm64.tar.gz`. Original source CI metadata binds both
artifacts. Before publication, verify the published release's source SHA, archive
lengths/SHA256 hashes, native Linux configs, source/version labels and every
filesystem layer. A dispatch cannot supply a different platform pair.

Verified native images receive immutable `v<version>-amd64` and
`v<version>-arm64` tags. `WEBSITE_MULTIARCH_RELEASES` defaults to `false`, retaining
the amd64 canonical/latest behavior while both native children are staged.
Production sets the flag to `true`. The canonical `v<version>` and `latest` contain
the complete verified Linux amd64/arm64 index. Existing x86 tasks select the x86
child. Once `latest` is an index, both the legacy publisher and flag-off dual
publisher refuse to replace it with an x86-only image.

The website ECR repository must use `IMMUTABLE_WITH_EXCLUSION` with exactly
`latest`, `deps-cache` and `deps-cache-arm64` mutable. The publisher verifies the
live policy before any child upload or canonical/latest write. No new IAM
permission is proposed. Record the previous policy for rollback; apply a live
policy change only within the specific approved scope.

The live lifecycle policy protects the newest image tagged with the
`rollback-website-arm64-x86-` prefix, ahead of the general 15-image policy.
Verify that the exact fallback remains available before changing architecture.

Do not convert an already-published canonical version between single-image and
index modes. Its immutable collision guard requires a fresh ordinary release
version. If the first migration release is to use an index, enable the reviewed
flag before that release is published; do not toggle modes halfway through it.

## Architecture handover

1. Capture the live service and task settings, then verify the active and
   fallback image references against the ECR index. Keep index publication and
   its immutable native children available throughout the handover.
2. Qualify the exact replacement image on isolated Fargate capacity sized
   like production. Exercise cold readiness, SSR/static pages, media
   generation, both public domains, recitation playback and ranges, cache
   invalidation, and recovery. Use fixtures or read-only data.
3. For an approved change, serialize the handover with ordinary website CD
   using the queue lock below. Any temporary change to the website EventBridge
   rule is part of that approved scope. Keep an old healthy task available
   until the replacement is ready and Cloud Map discovery has propagated.
4. Preserve CPU, memory, health checks, stop timeout, roles, secret mappings,
   and networking. Verify running image and architecture, deployment state,
   discovery and public behavior.
5. Before releasing the queue lock, verify that `bible-on-site:latest` selects
   the qualified child for the resulting architecture. If the handover used a
   digest pin, deploy an equivalent task definition using that release tag
   and verify the running task still uses the qualified digest. Then restore
   the normal EventBridge rollout owner and clear any task protection and
   temporary qualification resources. The rollout Lambda reuses the service's
   task definition, so a remaining pin prevents later releases from loading
   their new image.

## Deployment queue lock

The manual `website-handover-lock.yml` workflow shares exactly the ordinary
website CD concurrency group, with cancellation disabled and every dispatch
queued. It has no AWS credentials or OIDC permission and cannot perform the
architecture switch. Its sole purpose is to keep another ordinary release from
moving `latest` while the separately approved operator performs the handover.

After isolated qualification, create a dedicated GitHub deployment with task
`deploy:website-arm64-migration`, environment `website-arm64-migration`, the
approved merged control-source SHA, and payload exactly containing `purpose`,
`nonce`, `sourceRef`, `account`, `region`, and `service`. The purpose is
`website-arm64-migration`, the nonce is 32 lowercase hexadecimal characters,
and the AWS target matches the live service. Dispatch the lock with that ID,
nonce and source SHA. The workflow refuses a source not merged into master.
Its run name includes the nonce so an interrupted dispatch acknowledgement can
be reconciled without dispatching it again. A completed dedicated record is an
idempotent no-op; any existing owner or failed attempt requires reconciliation
and a fresh record/nonce. A workflow retry never silently renews the hold.

Before any migration write, verify that the lock run is in progress in the
correct queue, its workflow/control source matches the approved implementation,
and its dedicated deployment's latest status is `in_progress` with description
`website-arm64-lock:<nonce>` and a log URL pointing to that exact run. Then
recheck the actual registry/service state. Hold ownership must remain valid
through every phase; do not start a phase without enough remaining hold budget
for its completion and rollback.

Only after final public verification, event-owner restoration and lease cleanup
post a `success` status with description `website-arm64-complete:<nonce>` to that
dedicated deployment. The lock exits successfully and queued ordinary releases
resume. A wrong owner, missing marker, failed status or the fixed 30-minute hold
deadline fails closed; the operator must reconcile and restore the verified x86
fallback if necessary. Do not extend the hold to conceal a slow/failing handover.

## Rollback

While holding the deployment queue lock, restore the verified immutable
fallback and captured task configuration through the protected handover.
Verify public routes and steady ECS counts. Reconcile `bible-on-site:latest`
with the verified image, restore the release-tag task definition and
EventBridge rollout owner, and clear task protection. Release the lock only
after those steps because ordinary CD resumes when the lock exits.

If the hold expires during rollback, retain the verified fallback and treat
the interrupted rollback as an incident. Reconcile the actual task definition,
registry tags, EventBridge rule, and queued releases before another handover.
