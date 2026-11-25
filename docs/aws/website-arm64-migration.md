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

Since the amd64 retirement (#3794), a single `package_website` job on the
native ARM runner builds the website Dockerfile and source version. The
ARM64 dependency-cache artifact (`website-deps-cache.master.arm64`) keeps the
native cache isolated. The final standalone runner executes an actual
sharp/libvips JPEG encode, resize and decode before the image can be
published. Its Node architecture must match the build target. This
supplements the existing native SWC/libvips dependency check.

Trusted repository PRs and merge groups run the full SSG release build,
including the existing production-content and recitation/playback verifiers at
the deployed CPU/memory limits. Owned temporary RDS build access is cleaned up
on success or failure. Fork PRs cannot receive production secrets and keep the
existing credential-free architecture validation. Triggered packaging failures,
cancellations, skipped builds and empty/mismatched versions block the quality
gate. Published releases consume only their original master push artifacts.

The ARM64 archive is the only release archive:
`bible-on-site-v<version>-arm64.tar.gz`. Original source CI metadata binds the
artifact. Before publication, verify the published release's source SHA,
archive length/SHA256 hash, native Linux config, source/version labels and
every filesystem layer. A dispatch cannot supply a different platform set.
Historical paired releases keep their amd64 archive readable for rollback.

Verified native images receive the immutable `v<version>-arm64` tag.
`WEBSITE_MULTIARCH_RELEASES` defaults to `false`, which would publish the
single ARM64 manifest as canonical/`latest`; production sets the flag to
`true`, so the canonical `v<version>` and `latest` contain an OCI index over
the verified Linux arm64 child. Once `latest` is an index, both the legacy
publisher and flag-off native publisher refuse to replace it with a bare
manifest.

The website ECR repository must use `IMMUTABLE_WITH_EXCLUSION` with exactly
`latest`, `deps-cache` and `deps-cache-arm64` mutable. The publisher verifies the
live policy before any child upload or canonical/latest write. No new IAM
permission is proposed. Record the previous policy for rollback; apply a live
policy change only within the specific approved scope.

The live lifecycle policy protects the newest image tagged with the
`rollback-website-arm64-x86-` prefix, ahead of the general 15-image policy.
Verify that the exact fallback remains available before changing architecture.

Publish new image content under a fresh release version. Existing canonical
version tags are immutable, and ordinary CD requires the multi-architecture
index.

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
   and networking. For each task definition deployed during the handover,
   verify the replacement's digest, architecture, readiness, and Cloud Map
   registration. Use the nginx release-probe log's upstream address to
   attribute passing public health, readiness, and recitation probes to the
   replacement task. After the replacement passes, release only outgoing
   task protection owned by this handover so ECS can retire the old task.
   Wait for steady state and verify the running digest, discovery, and public
   routes again.
5. Before releasing the queue lock, verify that `bible-on-site:latest` selects
   the qualified child for the resulting architecture. If the handover used a
   digest pin, deploy the equivalent release-tag task definition through the
   readiness, protection release, and steady-state checks in step 4. Restore
   the normal EventBridge rollout owner and clean up temporary qualification
   resources after that deployment is steady. The rollout Lambda reuses the
   service's task definition, so ordinary CD depends on the release-tag
   definition.

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

Use the [protected deployment and release-tag checks](#architecture-handover)
in steps 3 through 5 with the captured task configuration and verified
immutable fallback. An x86 fallback deploys by its pinned image reference —
the immutable `v<version>-amd64` tag or the recorded digest — never by
resolving `latest` or the canonical `v<version>` index, which now select
Linux/ARM64 only (#3794). Keep the same queue lock through both the fallback
deployment and restoration of the release-tag definition; the restored
definition must carry the same pinned x86 reference so the rollout Lambda
resumes on it. Ordinary CD resumes when the lock exits.

If the hold expires during rollback, retain the verified fallback and treat
the interrupted rollback as an incident. Reconcile the actual task definition,
registry tags, EventBridge rule, and queued releases before another handover.
