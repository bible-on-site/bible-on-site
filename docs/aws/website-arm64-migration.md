# Website ARM64 migration

Status: prepared migration; no production architecture, registry policy or
publication flag change has been applied. Dorad requested the website migration
on November 1, 2026. Merge and live writes require approval of this specific PR's
current AWS impact under the root `AGENTS.md`.

## Baseline and intended scope

Read-only inspection at 2026-11-01 13:01 UTC verified account 250598594267,
region il-central-1, cluster `bible-on-site-cluster`, service
`bible-on-site-website`, task definition revision 16. The website runs one healthy
x86 task with 256 CPU units and 2048 MiB. The image follows
`bible-on-site:latest`; the website EventBridge rule owns ordinary deployments.

Migrate the website processor architecture to ARM64. Preserve capacity,
roles and secret mappings, networking and discovery, public/crawled URLs,
database content, application behavior, cache policy, the existing readiness
limits and the 120-second container stop timeout. API, admin and RDS are outside
this migration. Reference CloudFormation files document the target only; do not
deploy these untested templates.

The live revision 16 overrides the Dockerfile health check with only
`/api/health/ready` (curl maximum 5 seconds). The reviewed migration also aligns
that command with the already-tested Dockerfile/reference check: readiness,
recitation catalog, and chapter 2, each with curl maximum 3 seconds. The three
requests fit within the existing 10-second health timeout. Interval 30 seconds,
start period 120 seconds and five retries remain unchanged. This warms the
actual critical route bundles before the new task is eligible for public
traffic. Verify the aligned command first on the pinned x86 fallback, then ARM.

## Native build and release contract

Both native runners build the same website Dockerfile and source version.
Architecture-specific Bun and ECR dependency caches prevent cross-architecture
cache reuse; the existing x86 `deps-cache` name remains valid and ARM uses
`deps-cache-arm64`. The final standalone runner executes an actual sharp/libvips
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
With the reviewed flag set to `true`, canonical `v<version>` and `latest` contain
the complete verified Linux amd64/arm64 index. Existing x86 tasks select the x86
child. Once `latest` is an index, both the legacy publisher and flag-off dual
publisher refuse to replace it with an x86-only image.

The website ECR repository must use `IMMUTABLE_WITH_EXCLUSION` with exactly
`latest`, `deps-cache` and `deps-cache-arm64` mutable. The publisher verifies the
live policy before any child upload or canonical/latest write. No new IAM
permission is proposed. Record the previous policy for rollback; apply a live
policy change only within the specific approved scope.

The current lifecycle rule selects any images beyond the newest 15, so a digest
pin alone does not retain a fallback. Add a higher-priority rule selecting
`rollback-website-arm64-x86-` tags and retaining its newest one image. Apply an
immutable tag in that namespace to the verified native x86 fallback before the
ARM cutover. The lower-priority existing 15-image rule cannot expire that newest
protected image. This can retain one additional image and its layers; it adds
no running task. Preview both rules and verify the exact fallback stays present.
The [November 1 preview evidence](website-arm64-retention-preview.json) records
AWS accepting the actual proposed policy and a shadow experiment preserving an
older image despite an aggressive lower-priority cleanup rule. Neither preview
changed the live policy or deleted an image.

Do not convert an already-published canonical version between single-image and
index modes. Its immutable collision guard requires a fresh ordinary release
version. If the first migration release is to use an index, enable the reviewed
flag before that release is published; do not toggle modes halfway through it.

## Approval and qualification sequence

1. Complete current-head CI, six coverage gates, quality annotations, bot/issue
   comments, submitted reviews and every review thread. Bind approval to the
   specific PR/head and describe registry policy, flag and cutover impacts.
2. Recheck the target account, healthy website state, latest/canonical tags and
   current lifecycle policy. Preview the policy against the index/child layout;
   verify that the known-good x86 rollback manifest and layers remain retained
   throughout the migration. Save immutable image and complete service/task
   configuration evidence without serializing credentials or environment values.
3. Within the approved scope, apply only the reviewed website tag-mutability
   policy, fallback-retention rule and publication flag, then merge. Follow both native master builds,
   the exact published release and ordinary x86 index deployment through public
   verification. Do not cut over to ARM after a failed build or deployment.
4. Qualify the exact published native ARM image on isolated Fargate capacity
   with the same website CPU/memory. Use isolated/read-only data and fixture
   revalidation; preserve production content and assets. Exercise cold readiness,
   SSR/static pages, articles/authors/places, image/download processing, both
   public host contracts, recitation catalogs and actual MP3/Opus playback/ranges,
   cache and revalidation behavior, sustained/burst traffic, and outage/recovery.
   Keep existing deadlines; fix a regression rather than increasing its limit.
5. Retain and verify a completed immutable x86 fallback. Serialize the cutover
   with ordinary website releases; temporarily disable only the website ECR
   event rule if the reviewed manual handover needs sole ownership. Preserve
   an old healthy task until replacement readiness and discovery are verified.
6. Clone the actual full task definition, changing only architecture, image and
   the reviewed critical-route health command above.
   Verify a qualified ARM native pin, then ordinary ARM `latest` resolving to
   that same child. Verify healthy counts, exact runtime architecture/digest,
   completed ECS deployment history, Cloud Map and public traffic. Restore the
   ordinary website event rule before declaring delivery complete.
7. Independently verify owned protection/markers cleared and all isolated tasks,
   services, security groups and logs cleaned up. Preserve rollback artifacts,
   shared fixtures and production logs. Record the final live revision and proof.

## Rollback

Before ARM cutover, restore the recorded previous registry mutability/lifecycle and revert
the workflow change if necessary. A recorded immutable release tag is never
overwritten to change modes. After index activation, retain the publication flag
and both native archives for ordinary releases; turning the flag off cannot
safely restore an ARM service.

For a failed ARM handover, restore the completed immutable x86 task definition
using the reviewed, ownership-scoped handover. Verify public behavior and steady
counts before releasing protection. Record the incident and reconcile any
in-flight deployment before another attempt. No database rollback or public URL
change is part of this recovery.
