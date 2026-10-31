# ARM64/Graviton multi-arch validation and canary plan (issue #2562)

Investigates ARM64/Graviton savings for the three ECS Fargate services -
website, API and admin - **without changing production behavior or breaking
rollback**, as required by
[#2562](https://github.com/bible-on-site/bible-on-site/issues/2562).
Follow-up from [#2576](https://github.com/bible-on-site/bible-on-site/issues/2576);
reference audit: [cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md).

**No production architecture/image/service change or AWS-related PR merge
without Dorad's explicit approval of the specific PR's current impact.
Auto-merge off.** This document separates repository/registry research,
read-only AWS inspection, isolated validation, and production migration.
The initial research pass had no AWS credentials; its findings are not live
AWS proof. A later authenticated investigation does not authorize a production
migration. Record dated observations below and leave unexecuted steps marked
as proposals. Candidate tasks, image pushes, task-definition registration,
lifecycle changes, and service updates require the applicable explicit scope
of approval before execution.

Production baseline from the 2026-10-23 audit (re-read live before any
approved step): account **250598594267**, region **il-central-1**, cluster
`bible-on-site-cluster`; services `bible-on-site-website` (task rev 16),
`bible-on-site-api` (rev 5), `bible-on-site-admin` (rev 6), each
desired/running 1. Website/API run on-demand `FARGATE`; admin runs
`FARGATE_SPOT` since 2026-10-24 ([rollout record](admin-spot-rollout.md)).

## Repository and registry feasibility

### Base images have ARM64 variants

The initial research pass inspected these registry indexes (anonymous
Docker Hub access). Mutable tags must be rechecked and their resolved
index/child digests captured for the exact build being qualified:

| Base image | Used by | linux/arm64 child |
| --- | --- | --- |
| `node:26.12.1-alpine` | website + admin (all stages) | yes (`arm64/v8`) |
| `oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a` | website + admin (`COPY --from` of the bun binary) | yes - the pinned digest is itself an **OCI index** containing `linux/amd64` and `linux/arm64`, so the pinned reference resolves per-architecture and does not smuggle an x86 bun into an ARM image |
| `rust:1.99.1-alpine` | API build stage | yes (`arm64/v8`) |
| `alpine:3.24.3` | API final stage | yes (`arm64/v8`) |

These indexes make native ARM64 builds plausible without changing the
`FROM` references. They do not prove that dependency installation, application
build, or the final image runs correctly on ARM64.

### Native build dependencies and runtime dependencies

The lockfiles describe available packages, not a successful install or a
complete inventory of the final image. Keep build and runtime claims separate:

| Service | Build-time native surface | Runtime surface and remaining proof |
| --- | --- | --- |
| website (Next.js 16.4.3 standalone) | Next SWC, Bun, and tooling such as esbuild have architecture-specific packages; inspect the resolved Linux/musl ARM64 packages during the real image build | `sharp@0.35.5` is used by `src/lib/download/perek-export-content.ts` for illustration resize/JPEG conversion. `bun.lock` includes `@img/sharp-linuxmusl-arm64` and `@img/sharp-libvips-linuxmusl-arm64`; successful install, standalone tracing, and an actual transcode still need proof. Inspect the packaged output for any other native artifacts before claiming a complete runtime audit |
| admin (TanStack Start, Node) | Vite/Rolldown, Lightning CSS, and Tailwind Oxide include native build components; its lockfile has Linux/musl ARM64 variants | Application dependencies such as `mysql2`, `@aws-sdk/*`, and `jose` are JavaScript. This does not prove the generated `.output` is entirely architecture-neutral; inspect it, start it on ARM64, and exercise authentication and DB reads |
| api (Rust, musl static) | Native `cargo build --locked --release`, including `openssl-sys` and the `ring` dependency graph; the Dockerfile uses `openssl-libs-static` | Alpine aarch64 packages and upstream aarch64 support establish feasibility. Build the actual image natively, inspect the ELF architecture/linkage, then test its GraphQL and DB paths. Native ARM64 builds avoid a cross-compile toolchain |
| bulletin (Lambda ZIP, `web/bulletin/Dockerfile`) | Rust musl | Out of #2562 scope; its ZIP and Lambda architecture are a separate approval/change |

The website/admin Node entrypoints are JavaScript; API `/bin/server` must be
compiled for the target architecture. Fonts bundled as bytes do not require
container-side font rendering. These facts do not remove the native build
requirements above.

The website Dockerfile defines a health check. API/admin must be probed
explicitly; do not assume every image has a Docker health check. More
importantly, ECS only observes checks configured in the **task definition**,
not an image's `HEALTHCHECK` alone. The current reference definitions have no
API/admin task health check; confirm the live definitions before rollout.

API startup also launches the article-search worker unconditionally. It runs
three `CREATE TABLE IF NOT EXISTS` statements, may retrain/write derived
search tables, and periodically drains/reconciles the search queue. HTTP
read-only probes do not make an API task read-only. Qualify the complete
worker against a separate MySQL server. A separate schema or SELECT-only
credentials on the production server are insufficient: the worker's named
`article_search_retrain` lock is server-wide and can contend with production.
Do not connect an API candidate to that server, even for HTTP read probes. A normal production
`DB_URL` must not be cloned into another investigation task on the assumption
that startup only reads.

## What still needs proof on actual ARM hardware

Registry and code inspection cannot substitute for the issue's required
runtime verification. This migration checklist is only partly covered by
the dated native-build and placement evidence below; untested items remain
qualification gates:

1. Startup/readiness on Graviton under the deployed limits (0.25 vCPU;
   2048 MB website, 512 MB api/admin), including the website's cold
   canonical-data load that caused the 2026-10-06 handover stalls
   ([record](deployment-readiness-2026-10-06.md)).
2. SSM `Secrets:` resolution at task start (`DB_URL`, `REVALIDATE_SECRET`,
   `INDEXNOW_KEY`) and networking via the live private-DNS SSM endpoint -
   unchanged in principle (secret injection is execution-role + endpoint
   work, not ISA work) but must be observed on the candidate task.
3. DB/API behavior: GraphQL queries against `tanah-mysql`, website dynamic
   pages/ISR, admin session/auth flow.
4. sharp transcode correctness on the bulletin-export path, plus successful
   native build tooling and a recorded final-image native artifact inventory.
5. Public content: canonical/legacy URL matrix, recitation content and
   playback, image/audio Range+CORS - the same probe set the audit and
   post-deploy verifier already run.
6. Measured startup latency, peak memory and CPU under realistic traffic
   versus an amd64 baseline.
7. Fargate ARM64 availability in il-central-1: the AWS price list publishes
   ARM vCPU/GB on-demand **and** Spot rates for il-central-1 (below), which
   is strong evidence of support, but actual task placement and, for admin,
   **ARM Spot capacity** must be observed live.

## Actual cost delta (published il-central-1 rates)

Rates read from the AWS price-list files the 2026-10-24 rollout doc cites
([ECS on-demand](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ecs/USD/current/ecs.json),
[Fargate Spot](https://dftu77xade0tc.cloudfront.net/fargate-spot-prices.json)),
Israel (Tel Aviv) / `il-central-1`, USD/hour:

| Meter | x86 | ARM64 | Delta |
| --- | --- | --- | --- |
| On-demand vCPU | 0.0518144 | 0.04145152 | **-20.0%** |
| On-demand GB | 0.0056896 | 0.00455168 | **-20.0%** |
| Spot vCPU | 0.01554432 | 0.01243546 | **-20.0%** |
| Spot GB | 0.00170688 | 0.0013655 | **-20.0%** |

Monthly compute (730 h) per service at current sizes:

| Service | Size (vCPU/GB) | Today | On ARM64 | Delta/mo |
| --- | --- | --- | --- | --- |
| website | 0.25 / 2 | $17.76 on-demand | $14.21 on-demand | **-$3.55** |
| api | 0.25 / 0.5 | $11.53 on-demand | $9.23 on-demand | **-$2.31** |
| admin | 0.25 / 0.5 | $3.46 Spot x86 | $2.77 Spot ARM *if* ARM Spot placement works | **-$0.69** |
| **Total Fargate compute** | | **$32.76** | **$26.20** | **-$6.55 (-20%)** |

Totals use unrounded hourly calculations before rounding to cents; displayed
service rows are rounded separately.

The math method is the same one that produced the audit's $11.53/$3.46
figures (verified against the published rates here). The default **20 GB
of Fargate ephemeral storage is included at no additional charge**; only
configured storage above that allowance is billed. Architecture does not
change that allowance or public IPv4, CloudWatch Logs, and data-transfer
pricing. This public repository's standard GitHub-hosted amd64 and ARM64
build runners are free; adding a native ARM build does not add billed build
minutes. See [GitHub's standard runner pricing](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Additional ECR layers cost $0.10/GB-month in this region: 1 GB adds $0.10/month,
and 10 GB adds $1/month. The API image is about 15 MiB compressed, so its
additional image storage is small compared with the estimated $2.31/month
API compute saving. Retained layers and Actions artifact/cache storage still
need measurement; the current evidence supports likely net savings, with
qualification and rollback as the remaining migration gates. See
[AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/) and
[ECR pricing](https://aws.amazon.com/ecr/pricing/).
**Admin caveat:**
ARM on-demand ($9.23) costs *more* than today's x86 Spot ($3.46) - admin
must migrate onto Spot ARM capacity, or the move is a cost regression.
The dated investigation below proves one ARM Spot placement in il-central-1;
it does not establish future capacity or complete admin qualification.

This is a modest saving. The honest expectation is ~$6.5/month of Fargate
compute, ~20% of that line - not a large bill change. The migration's cost
must justify its risk; that call is Dorad's per the approval rule.

## Native CI qualification added in this change

[architecture-validation.yml](../../.github/workflows/architecture-validation.yml)
runs on native amd64 and ARM64 GitHub-hosted runners. Its callers and
`cross_module_ci` gating are added together. It uses no AWS credentials and
does not push ECR images, publish release assets, change `latest`, register
ECS definitions, or update production services.

- API/admin build their real final image and run native runtime smoke probes.
  Isolated candidate image tars, checksums, and inspection metadata are kept
  as seven-day Actions artifacts, separate from the production release path.
- Website validates its dependency stage, including native Sharp/SWC loading.
  It does not perform production-DB-backed SSG or qualify the website's full
  standalone runtime. Those remain explicit gates before website migration.
- Workflow implementation is not successful execution evidence. Record the
  exact head, run results, artifact hashes and scope below after CI finishes.
  Seven-day candidate retention is not a production rollback-retention policy.

## Multi-arch release changes still needed (proposal only)

Current chain (`shared-dockerize.yml`, `package_admin` in `ci.yml`,
`shared-release.yml`, `cd-aws.yml`, `devops/deploy/ecr-deploy`):

```
docker buildx build --load (amd64) → docker save → <image>-v<ver>.tar.gz
→ GH release asset → cd-aws: crane push → ECR :v<ver> and :latest
→ EventBridge rule on "latest" PUSH → ECS forceNewDeployment
```

Three properties constrain the design:

- `docker buildx build --load` exports a **single** platform; the
  `docker`-driver builder cannot emit a manifest list without the
  containerd image store. Per-architecture builds are therefore required -
  which also keeps today's tar release contract intact per arch.
- `docker save` preserves a single-arch image; the multi-arch object in
  ECR is assembled at push time from already-pushed children.
- The auto-deploy trigger keys on `latest` only; per-arch and versioned
  tag pushes do not deploy.

### Proposed minimal-diff changes

1. **Build per-arch on native runners.** Add an `arch` dimension to the
   dockerize jobs: `linux/amd64` keeps `ubuntu-latest`; `linux/arm64` runs
   on `ubuntu-24.04-arm` (GitHub-hosted ARM64 runner, free for this public
   repository). QEMU (`docker/setup-qemu-action`) is the correctness
   fallback - viable for the small admin/API images, too slow to be the
   routine path for the Rust release build and the SSG website build.
   Preserve `<image>-v<ver>.tar.gz` as the amd64 release asset and add
   `<image>-v<ver>-arm64.tar.gz` for ARM64. Update every producer/consumer
   together; renaming the amd64 tar would break the existing release contract.
2. **Publish the index at deploy time.** `cd-aws.yml` pushes each arch tar
   via `crane push` to `v<ver>-amd64`/`v<ver>-arm64`, then composes the
   manifest list over already-pushed children -
   `crane index append -t <repo>:v<ver> -m <repo>:v<ver>-amd64 -m <repo>:v<ver>-arm64`
   and the same for `latest` (`docker buildx imagetools create` is the
   equivalent; crane is already installed in cd-aws). Only the final
   `latest` publication should match the current EventBridge tag filter;
   arch/version pushes must not match. ECR notifications are best effort,
   so verify the actual deployment rather than promising exactly one event.
   Existing X86_64 definitions should resolve the amd64 child of a complete
   index; verify both platform pulls and their image/version provenance.
   Before index publication, test `resume-image.mts` with an index media type
   and all referenced children present in the same repository. No support
   claim substitutes for that end-to-end qualification.
3. **Per-arch build caches.** The website `deps-cache` ECR tag is a
   single-arch amd64 image; arm64 builds need a parallel ref
   (`bible-on-site:deps-cache-arm64`). The `type=gha` scopes for api/admin
   similarly gain `-arm64` scopes so arch layers never cross-pollinate.
4. **Gate it.** Any added arm64 job must enter `cross_module_ci` under the
   same trigger condition as its amd64 twin (the merge-gating rule in
   `.github/instructions/aws-workflows.instructions.md`), so a broken arm64
   build blocks merges exactly like an amd64 one. The website remains
   master-push-only for its DB-backed SSG build - its arm64 variant runs
   there before the release it feeds, never as a pre-merge no-op.
5. **Manifest/digest inspection in CI.** Record `crane manifest
   <repo>:v<ver>` / `docker buildx imagetools inspect` output (amd64 +
   arm64 children with digests) in the deploy job log so the pinned
   candidate/rollback digests are artifacts of the run, matching the
   issue's "inspect manifest digests" requirement.

### Deployer and retention prerequisites

- Remote version selection must accept only canonical release tags matching
  `^v\d+\.\d+\.\d+$`, compare semantically, and ignore cache/architecture
  tags. Otherwise `deps-cache` and `v<ver>-arm64` can distort the decision.
  Validate empty, paginated, and mixed-tag results before multi-arch rollout.
- Read the **live** ECR lifecycle policy and run a preview against the
  proposed tag/index layout. Two platform children plus an index increase
  image count, but retention is not a simple threefold formula: ECR cannot
  expire a child while a retained manifest list references it. A limit of
  15 images is not a promise of 15 rollback releases.
- Recording a digest does **not** preserve its manifest or layers. Before
  migration, retain the running known-good amd64 image and any required
  index/children under a reviewed lifecycle policy, or in a verified recovery
  repository with retention that covers the rollout and rollback window.
  Preview policies, confirm the rollback digest is retrievable, and rehearse
  restoring/pulling it. A new tag alone does not protect an image from a
  policy selecting all images. Any policy/repository change is separately
  AWS-impacting and needs approval before application.

See [ECR lifecycle evaluation](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html).

### Steady-state release contract must be settled before service migration

The deployed ECR event handler calls `UpdateService(forceNewDeployment=True)`;
it does not register a new task revision or replace a digest pin. Leaving an
ARM64 service pinned to a qualification digest freezes routine releases.

The proposed minimal-change steady state is an ARM64 task revision using
`<repo>:latest`, with each approved routine release publishing a complete,
validated amd64+arm64 index. Use a digest pin for isolated qualification and
for a bounded migration/recovery step, then explicitly transition to that
reviewed steady-state revision before the next release. Verify its resolved
ARM child equals the qualified digest and that no concurrent release/tag
change occurred. Alternatively, implement and validate a per-release,
digest-pinned task-revision deployer before choosing permanent pins. That is
a different pipeline change, not functionality provided by the current
force-only handler. Until one contract is implemented and approved, service
migration is blocked.

### Phasing that keeps `latest` amd64-only until approved

The safest sequencing: phase 1 ships per-arch builds + `v<ver>-<arch>`
tags only, leaving `v<ver>`/`latest` pointing at the amd64 image exactly as
today. The isolated ARM64 candidate then pins the `v<ver>-arm64` digest.
The index flip on `v<ver>`/`latest` lands only when a service is approved
to migrate - so the tag semantic changes at the moment it is actually
needed, not before. Both sub-phases keep amd64 published. Digests identify
immutable content, but the retention prerequisite above is what preserves
that content for recovery.

### API release preparation (2026-10-29)

The current implementation prepares the API first. Its regular packaging job
builds and verifies both final images on native runners. Published releases
retain the existing amd64 archive name and add an ARM64 archive; deployment
verifies both published SHA256 digests and matching source/version labels.
The publisher stages immutable `v<version>-amd64` and `v<version>-arm64`
children. With `API_MULTIARCH_RELEASES` unset or `false`, canonical version
and `latest` still resolve to the amd64 image. No service architecture changes.

Before merging, verify the API ECR repository uses `IMMUTABLE_WITH_EXCLUSION`
with only exact `latest` mutable. Authenticated inspection found no API
lifecycle policy; preserve that retention, rather than applying the reference
file's former fictional 15-image policy. Do not deploy the reference template.
An established multi-architecture `latest` cannot be downgraded by turning
the flag off or replaying a legacy single-image release. Enabling index
publication requires a new version; an immutable amd64 version cannot be
rewritten as an index.

The API adds `/health/ready` for database/search-worker readiness while keeping
`/health` unchanged. Local full worker and HTTP checks pass against disposable
MySQL servers. Native ARM CI and representative isolated Fargate comparisons
remain required before a production cutover. ECS readiness, circuit-breaker,
and architecture changes belong to that later qualified step; they are not
part of this release preparation. Preserve the healthy 0.1.95 full task
definition and image as rollback, since older images lack this new endpoint.

### Local full-corpus qualification (2026-10-29)

The public API supplied a frozen corpus of 2,681 articles, 68 authors,
35 books and 929 chapters without database credentials, private content or
production writes. The isolated test adds one clearly synthetic article and
author plus dedication/coverage edge rows. Public HTML/name/abstract bytes,
nulls and reference closure were checked after import. Raw data and operational
artifacts remain private; these are temporary qualification inputs.

At the existing 0.25 vCPU/512 MiB limit, the original actual API image answered
liveness in 0.819 seconds but failed the unchanged 30-second readiness gate.
A separately labeled diagnostic run became ready after 84.240 seconds:
model construction took about 36 seconds and 2,682 individual document commits
spent 43.289 seconds in SQL. No other server-wide lock owner was present.
This failed baseline remains recorded; the deadline was not increased.

The revised LSA projection traverses contiguous output coordinates while
preserving every scalar accumulation's order, seed, vocabulary, dimensions
and scaling. Its measured projection fell from 17.994 to 0.789 seconds; full
basis/model/document embeddings and six query score/ranking sets were bitwise
identical. Documents, model state and epoch stamps now publish in one SQLx
transaction on the retained named-lock session. Real MySQL tests prove that
an error or cancellation during the second document write preserves every
prior publication byte, releases the session, and leaves a warm reader usable.

The combined actual-Dockerfile image passed the same full-corpus cold gate in
26.586 seconds. Document SQL took 1.699 seconds, and warm readiness took
1.519 seconds while a separate test session held the retraining lock. The
hard limits remained 0.25 vCPU/512 MiB; process high-water RSS was about
216.45 MiB and there was no OOM. That revision's normal validation passed 297 unit tests,
two mandatory MySQL tests and 59 HTTP E2E tests; merged API line coverage was
13,241/13,392 (98.872%), above the unchanged 97% gate. Local image labels
explicitly identify the working tree; final native CI must bind published
images to the committed source. These are local amd64 results, not ARM or
Fargate performance evidence.

### Production-version repeat and further CPU headroom (2026-10-29)

The preceding cold/warm measurements used MySQL 8.4.13. A seed image pinned to
the official MySQL 8.4.9 amd64 child was then rehearsed to match production's
version. Its authenticated TCP/corpus-marker startup missed the unchanged
30-second database gate at 0.5 vCPU/1 GiB. At the valid Fargate size of
1 vCPU/2 GiB, it passed in 23.075 seconds. These are temporary database
resources; API and production resource limits remain unchanged. At the
published regional rates, that temporary server costs $0.0631936/hour of
compute, excluding public IPv4, logs, image storage and client tasks.

The API's first repeat against 8.4.9 missed its unchanged 30-second cold gate.
A separately labeled diagnostic became ready in 30.531 seconds, which remains
a failure. Another diagnostic became ready in 27.304 seconds; that single pass
does not erase the failure or establish reliable startup. The exact ordered
2,682 input rows and all public name/abstract/content hashes matched the prior
fixture, as did the resulting stored model. The CPU sample found no aggregate
VM starvation or OOM: training took 20.502 seconds, with the task using its
expected quarter-CPU quota. Subsequent public-data, seven dedication-scope,
queued-update and real-MySQL timestamp/atomic rollback/cancellation checks
passed. The new failure is retained and blocks qualification.

Two additional CPU changes retain the model contract. The compressed matrix
accumulates contiguous term rows, preserving every cell's original addition
order, then transposes without arithmetic. Normalization bypasses per-character
NFD only for identity-decomposition ASCII and regular Hebrew letters; all
other characters keep the original fallback. On pinned Rust 1.99.1, both
normalization modes matched over all 1,112,064 Unicode scalar values in two
contexts and every one of the public corpus's 8,043 name/abstract/plain-text
fields. Focused tests cover boundary blocks, duplicate/cancelling terms,
spacing, quotes, final letters and Unicode decomposition/case.

At 0.25 vCPU/512 MiB, the combined standalone profiler completed in
13.951 seconds, with 228.4 MiB process high-water RSS. Its complete basis,
persisted model, document embeddings and all tested query score/ranking bytes
match the original frozen baseline exactly. This is an amd64 algorithm proof,
not an API startup or ARM/Fargate result. Training now explicitly orders rows
by ID; this preserves the observed fixture order and prevents query-plan
changes from silently changing the model's input sequence.

The actual rebuilt Dockerfile image then passed two independent fresh-table
cold starts against MySQL 8.4.9 in **18.025 and 18.472 seconds**, using the
unchanged 30-second gate and 0.25 vCPU/512 MiB API limits. Warm readiness with
an independently held retraining lock passed in 1.234 seconds. Input bytes
and the stored model remained identical. The largest public HTML, all 929
chapter labels, covering-source TIMESTAMP, all seven dedication scopes,
expiry handling, 120 bounded HTTP requests, exact-holder release and queued
update checks passed. Both API candidates and the holder were cleaned up.

Fresh normal validation passed 301 unit tests, the nextest run, two mandatory
real-MySQL regressions and 59 HTTP E2E tests; all 18 report-watcher regressions
also passed. Merged API line coverage is 13,312/13,463 (98.878%), above the
unchanged 97% gate. Normal cargo-make lint, strict all-target Clippy and
rustfmt passed. These remain local amd64 results with honest working-tree
image/source labels. Final committed-source native CI, published archive
provenance and isolated AWS comparison remain gates before ARM migration.

The unexecuted AWS comparison plan uses a separate MySQL server and sequential
amd64/ARM64 API services at those same limits. It uses an owned temporary
cluster with Container Insights explicitly disabled: the production cluster's
Insights setting is enabled and remains untouched. Request `--include SETTINGS`
when inspecting a cluster; omitted settings do not mean disabled. Existing
roles, network rules and the strict SSH probe path are reused. Standard ECS
service metrics report observed sample maxima; they are not continuous peak
measurements. All temporary resources must be removed after qualification.

### Cold-start contention repeat (2026-10-29)

The preceding ordinary cold and warm results do not establish empty-index
recovery after a missed lock. A separate full-corpus case acquired the exact
server-wide lock before API startup. The API missed it at +0.893 seconds,
returned readiness 503, and the holder released it at +2.735 seconds. The
worker next acquired it at +15.922 seconds. Training completed at +27.440
seconds, but transactional publication was unfinished at the original
30-second deadline. The API stayed unready, with no OOM; the attempt is RED.
All owned API/holder/schema/user resources were cleaned up. No production
server or content was changed; writes were confined to the owned local fixture.

Fresh uncached API fixture credentials require TLS with the current SQLx
feature set. The final measured case proved a nonempty SSL cipher on the
API's own first connection; no separate client primed that account's auth
cache. Earlier harness/authentication/port errors are retained separately
and are not startup timing passes. This fixture transport requirement does
not change the separate db-populator tool's enabled features.

A private scalar-reference prototype groups four independent Gram cells
under one term scan and uses contiguous scratch columns for the same
two-pass orthonormalization. Every cell retains its original addition and
update order; no reduction is reassociated. At 0.25 vCPU/512 MiB, the complete
standalone run took 11.087 seconds, compared with the prior 13.951 seconds.
The Gram phase was 1.494 seconds and orthonormalization 0.280 seconds. All
25 release-mode tests passed, including partial blocks, zero/signed-zero,
ill-conditioned matrices and the full 144-column width. Complete basis,
model, embeddings and six query score/ranking outputs remain bitwise equal
to the frozen original baseline. Scratch columns add about 1.47 MiB for
this corpus during that phase.

This remains an algorithm measurement. The actual rebuilt API image must
pass the original cold-held 30-second case, ordinary cold/warm contracts,
normal tests, coverage and committed native CI before delivery. The fixed
15-second worker tick, lock timeout, API limits and readiness deadline are
unchanged. ARM/Fargate qualification remains blocked until those gates pass.

### Bounded atomic publication (2026-10-29)

The actual image containing the Gram/column-layout change passed an ordinary
cold start in 17.793 seconds, but its cold-held repeat remained RED. On the
retained Docker-start clock, the second lock attempt was at +15.390 seconds,
training completed at +25.444, the transaction began at +27.218, and COMMIT
was at +30.136. The worker logged its rebuild at +30.319, before loading
the in-memory snapshot and beyond the original deadline. The 2,682 document statements occupied 1.986 seconds from the first
to last completion, with 1.847 seconds summed query time. The state-blob write
took 0.786 seconds. A final evidence-writer defect lost the invocation-relative
probe JSON and CPU/host counters; these were not reconstructed. Immutable
Docker start and retained logs conservatively establish the failed gate.
Cleanup was independently verified, and remaining repeats were stopped.

A subsequent private MySQL 8.4.9 regression exposed a separate correctness
bug: full retraining upserted current documents but left removed/out-of-range
rows behind, then stamped those old vectors with the new model epoch. After
three source articles, deleting one produced two trained but three stored
rows; moving another outside chapter 1-929 left two stale stamped rows;
an empty source corpus still left all three. This is a failed baseline.

The correction deletes only the derived document table's rows inside the
existing lock-owning publication transaction, then inserts the complete new
snapshot, state and epoch stamp before committing. Source articles and the
incremental queue-upsert path are unchanged. Parameterized statements group
at most 64 rows and conservatively budget 256 KiB of SQL/binary bindings.
A single larger row uses the original scalar path, preserving its existing
capacity. An explicit ordinal orders writes, including repeated IDs; the
same authoritative source-membership predicate and server-side content hash
remain in use.

Private validation passed 306 unit tests and four real MySQL regressions
through the existing mandatory coverage entry point. Separate exact filters
run timestamps, full-retrain deletion/move/empty, batch parity/atomicity and
session-lock cleanup sequentially, preserve prior profiles with `--no-clean`,
and fail if any selected regression is missing. Binary NUL/non-UTF8/empty
values, partial batches, duplicate order, omitted source rows and a 300 KiB
scalar fallback match the original scalar bytes. A second-batch error and
actual in-flight cancellation restore every prior model/document byte and
timestamp and release the lock without leftover SQL. The deletion/move/empty
cases now store exactly three/two/one/zero eligible rows. Strict all-target
Clippy and formatting passed. The normal 59 HTTP and 18 report-watcher tests
also passed. Combined API line coverage is 13,834/13,987 = 98.90613%, above
the unchanged 97% gate.

The actual bounded-publication image
`d5f578578a386a3781ba398096683c0f58b42dca4bc568116d122435ab035024`
still failed the original cold-held readiness gate. On its immutable
invocation clock the next acquisition was +15.898 seconds, training finished
at +25.626, and the transaction began at +27.314. Forty-two bounded document
statements completed by +28.218, state publication by +28.992, and COMMIT at
+29.092. The worker's rebuild log at +29.212 preceded snapshot loading; model
and document queries completed at +29.318 and +29.531. Readiness remained 503
at +29.986. The process was alive without OOM, and cleanup/lock release were
verified. Query completion is not proof that the snapshot was adopted; the
post-fetch path was diagnosed before another repair was chosen.

One explicitly diagnostic follow-up kept the same source, image, limits and
immutable 30-second verdict, then made exactly one later readiness request.
The original gate failed; that later request was healthy at +33.114 seconds
and does not qualify the image. Before cleanup, all 2,682 document IDs and
vector/term/content hashes matched the scalar snapshot, as did the complete
model hash. There were no epoch mismatches, invalid vectors, malformed or
out-of-range terms among 871,549 decoded pairs, or rejection/decode warnings.
The late healthy response confirms eventual snapshot adoption. This isolates
the remaining failure to completion latency rather than a rejected snapshot.
Per-file cgroup-v1 counters were retained; exact owned cleanup and server-wide
lock release passed. No qualification retry or timeout change was made.

These results do not qualify a production image or ARM. The adopted source
still needs a passing actual-image cold-held/ordinary/warm suite, committed
native builds, canonical release verification and paired isolated AWS trial.
The original 30-second readiness gate, 15-second tick, lock timeout and task
resource limits remain unchanged.

### Cold lock wake-up and current local qualification (2026-10-29)

The cold-held failure included a released lock sitting idle until the next
15-second worker tick. After the root cause and connection tradeoff were
presented, Dorad explicitly authorized a one-time first-cold-start server
lock wait of up to 15 seconds. The 30-second readiness deadline, worker tick,
0.25 vCPU/512 MiB limits and pool size remain unchanged. Warm starts, manual
retraining and later cold-recovery attempts retain immediate lock probes.

The ordinary loader still takes its reload mutex before a pool checkout.
Cold initialization uses that same order and reloads through the physical
lock-owning session, so a one-connection pool cannot deadlock. After obtaining
the lock, it first adopts a compatible publication from the preceding owner
instead of training it twice. Failure preserves the existing fresh-connection
reload after releasing the session and mutex. Cancellation protection is set
before issuing GET_LOCK, including a grant whose response never reaches the
cancelled client.

The actual Dockerfile image is
`1b9043703b5275a2edafacaf44ef384f2999a0d8607ed71021c23bb2246996ad`,
with 132 production inputs bound to source hash
`d37499849f1d44d457478236e89ea719bcb725a4bfb9d66a8d45991b740f5e96`.
It uses honest working-tree labels and is not a canonical release artifact.
On the original immutable invocation clock, the exact fresh API session was
positively waiting on the named lock, readiness was 503, and the independent
holder was released at +2.308 seconds. Readiness succeeded at +11.408 seconds,
inside the unchanged 30-second gate. All 2,682 stored documents and the model
matched the scalar baseline, including 871,549 valid term pairs; no epoch or
vector errors, OOM, evidence loss or cleanup errors occurred.

Two separately invoked ordinary cold cases passed at 9.190 and 9.289 seconds.
Warm readiness while another session retained the lock passed at 0.906 seconds.
The largest article hash, all 929 chapter labels, timestamp mapping, all seven
dedication scopes/expiry cases, 132 bounded HTTP requests and the existing
worker queue deadline passed. The queued synthetic update was visible in
11.926 seconds. Local checks passed 311 unit tests, five explicitly selected
real MySQL 8.4.9 regressions, strict all-target Clippy and formatting. All
59 normal HTTP tests passed without skips or retries. The combined API report
covers 14,255/14,419 lines (98.86261%), above the unchanged 97% gate; every
mandatory MySQL test has positive recorded coverage hits.

These are local amd64 observations, not ARM/Fargate evidence. The prior failed
gates remain retained. An additional canonical 0.1.95 warm-compatibility check
proved positive search and unchanged data/state hashes, but its larger public
query failed the original two-second request limit, with a 2.188-second pool
acquisition. Its complete compatibility gate remains failed; the root cause
of that delay was not established. Before ARM cutover, the normal x86 phase
must establish a fully qualified current amd64 image and complete rollback
definition. Current committed native builds, release provenance, isolated AWS
comparison and final review remain gates; production is still x86.

### Combined dependency cleanup and runtime equivalence (2026-10-29)

The same release incorporates the validated dependency cleanup from
[#2828](https://github.com/bible-on-site/bible-on-site/pull/2828): the API no
longer declares the unused cargo-make CLI as a Rust dev-dependency, removing
103 orphan lockfile packages. No retained package versions are changed.
Normal/build package and feature graphs are identical for Linux amd64,
Linux ARM64 and Windows. CI still installs the explicitly pinned CLI;
its upstream ZIP compatibility limitation and Renovate tracking remain
recorded in [#2826](https://github.com/bible-on-site/bible-on-site/issues/2826).
This removes the unused API dependency graph; it does not claim the external
CLI is universally patched.

The combined actual Dockerfile image is
`4c7b8f28c204b6641ef65bbcddbb87ade30e9e211bdc222f3ccf94c54acdc5bf`,
bound to 132 production inputs with source hash
`b79154cc6c4a8f36d3e8115996dc2b0b7645ef4786cd728a8a000ef1c96f97f6`.
The rebuilt server is byte-identical to the qualified image above. Its 520
runtime filesystem entries (content, types, permissions, ownership, links
and extended attributes) and runtime configuration are also identical;
the comparison excludes Docker-injected host files, build timestamps and
provenance labels. This supports reusing the preceding local runtime
observations, rather than claiming they were repeated on a new binary.
The combined graph passes all 311 unit tests, strict all-target Clippy and
formatting. The preceding coverage and real-MySQL/HTTP results apply to
unchanged Rust/test sources. Current-head CI/native release verification
and isolated AWS qualification remain required.

### Native Fargate paired qualification (2026-10-29)

Both native API candidates were executed in an owned, isolated Fargate cluster
in `il-central-1b`, using the same frozen public corpus and MySQL 8.4.9 seed.
The API stayed at 256 CPU units/512 MiB and the separate fixture database at
1024 CPU units/2048 MiB. Container Insights was disabled on this temporary
cluster. No production service, database, route, DNS, IAM or existing security
group was changed. Production API/admin/website still use x86 task definitions.

The native candidate payloads bind all 132 production API inputs to the
qualified scalar implementation. They are research images in a separate ECR
repository, excluded from production deployment events; they do not establish
canonical release provenance or qualify a production cutover by themselves.

| Runtime case | x86 | ARM64 |
| --- | --- | --- |
| Fresh database TLS/corpus readiness | 17.372 s | 16.738 s |
| Cold API with independently held search lock | 15.926 s | 17.177 s |
| Exact holder released after positive pending-wait/503 proof | 1.447 s | 1.998 s |
| Ordinary cold API with derived tables absent | 15.139 s | 9.910 s |
| Warm API while another session retained the lock | 1.603 s | 1.756 s |
| Reuse of the other architecture's persisted snapshot | 1.514 s | 2.027 s |

The model and all 2,682 document content/vector/term fingerprints match the
original scalar baseline exactly on both architectures. Each cross-architecture
warm start preserved the model and document bytes. An early harness assumption
rejected the synthetic article's valid empty sparse-term list; its exact
baseline length and hash prove that zero terms is correct. The original failed
harness record remains retained. Startup anchors use AWS response timestamps,
including timestamp quantization and request time, mapped conservatively to a
monotonic clock. A detected laptop clock offset is excluded from the verdict.
No startup clock was reset and the readiness deadline stayed 30 seconds.

Each architecture then ran the identical recorded probe: five independent
functional projections once each, 12 warmups, six minutes at one request per
second with concurrency one, and 24 burst requests at concurrency four. All
402 traced HTTP requests per leg returned 200; each retained its two-second
limit. Article HTML/hash, all chapter labels, search IDs/scores, starter counts,
and dedication timestamp/scope/expiry responses matched exactly between legs.
The largest article contained 561,258 UTF-8 bytes.

| Observation from the paired trial | x86 | ARM64 |
| --- | --- | --- |
| Standard ECS average CPU utilization | 2.530% | 1.392% |
| Largest standard one-minute CPU datapoint | 11.185% | 1.506% |
| Standard ECS average memory utilization | 10.812% | 10.716% |
| Largest standard one-minute memory datapoint | 11.914% | 11.719% |
| Steady article request p95 | 126.803 ms | 91.809 ms |
| Steady search request p95, Shabbat | 23.075 ms | 22.352 ms |
| Steady search request p95, Bereshit | 25.725 ms | 22.253 ms |
| Steady dedication request p95 | 71.486 ms | 28.457 ms |

These are five complete standard one-minute metric buckets per architecture,
aligned to the actual server-side request trace. Their maxima are observed
one-minute datapoints, not continuous peaks. This is one sequential paired
trial, not an SLA, peak-load capacity claim or proof of a general speedup.

The functional collector originally combined five root projections into one
parallel GraphQL request before load. On a fresh x86 process, opening extra
SQL pool connections produced a 2.210-second server response, failing its
original two-second limit. The paired protocol instead performs the planned
independent projections sequentially; it does not retry a data request, prime
GraphQL before the contract check, change the pool, or relax any deadline.
The original compound-query failure remains a recorded limitation. The final
four-concurrent burst still exercises cold extra pool connections and passes
on both architectures. The exact old and final probe sources and failed
outcomes are retained privately.

An ARM synthetic-only queued update became searchable in 11.061 seconds,
within the existing 30-second worker check. All 2,681 public article hashes
were unchanged, the queue drained, and document content/model epochs agreed.
A replacement ARM task became ready in 2.010 seconds while 31 observed old-task
readiness checks remained 200; it reused the updated persisted model. The old
task subsequently stopped normally, but the original no-container-healthcheck
service did not report ECS `COMPLETED` within the unchanged 90-second deployment
observation. That overall trial remains failed. ECS readiness signaling and a
complete steady deployment remain a separate gate; task `RUNNING` or HTTP
readiness alone does not satisfy it.

A separate fresh ARM outage trial passed: after stopping only its disposable
database, the same API task kept liveness 200 and returned readiness 503 within
0.412 seconds. Its preceding cold start passed in 15.294 seconds with the
same exact model/document fingerprints. All tasks from those completed trials
were confirmed stopped. Nonrunning resource journals and candidate images are
retained until qualification ends.

A second isolated trial added an ECS container check against the actual
`/health/ready` endpoint, using the existing BusyBox executable (no image or
server-command change). The exact command returned exit 0 for HTTP 200 and
exit 1 for HTTP 503 in the qualified Alpine runtime. ECS on native ARM then
positively reported `HEALTHY`; initial API readiness was 16.248 seconds and
the initial deployment reached `COMPLETED`. Its rolling replacement was ready
in 2.492 seconds, ECS reported it healthy, and the old task stopped normally
with exit 0. At the last observation, 89.094 seconds after replacement
readiness, the service had desired/running 1, pending 0 and no failed tasks,
but still reported `IN_PROGRESS`. That rolling-completion gate remains failed,
including after adding the readiness signal. It is not evidence that simply
adding a health check fixes the control-plane completion delay. No observation
budget was extended. All owned tasks from this trial were confirmed stopped.
After reviewing that measured state and cost exposure, Dorad explicitly
approved one fresh isolated trial with a 180-second rolling-deployment
observation. That trial passed: initial API readiness was **14.969 seconds**,
the replacement was ready in **2.603 seconds**, and the old task stayed ready
through replacement readiness. ECS reported the replacement `HEALTHY`; the
old task was observed `STOPPED` by 58.639 seconds after replacement readiness.
The service then reported **`COMPLETED` at 103.463 seconds**, with desired/running
1, pending 0 and no failed tasks. Sampled new-task readiness remained 200
through completion, with each request retaining its two-second limit.

Only the rolling control-plane observation changed from 90 to 180 seconds,
under that explicit exception. API startup stayed at 30 seconds, requests at
two seconds, initial deployment observation and cleanup at 90 seconds, and
CPU/memory limits were unchanged. The earlier 90-second failures remain
recorded; they are not relabeled passes. All API and database tasks from the
approved trial were confirmed stopped, and its model/document fingerprints
matched the same scalar baseline. This qualifies one isolated ECS rolling
trial with the readiness check; it does not prove production traffic routing,
canonical release provenance or an architecture cutover. Applying that check
to production still requires specific AWS change approval.

Canonical publication and platform pulls, a fully qualified current x86
rollback definition, ECS readiness/circuit-breaker behavior, normal release
continuity, and current-head CI/coverage/all review channels still gate a
production ARM change. Website/admin require their own remaining checks. The
observed API headroom supports continuing qualification; it does not mean that
any production service has migrated or that the small published-rate saving
outweighs an unresolved compatibility gate.

## Isolated candidate design (phase 2 - requires authorized AWS access)

Multi-arch manifests do not select Graviton by themselves. Definitions without
`runtimePlatform` default to X86_64; ARM64 needs a new revision with explicit
`cpuArchitecture: ARM64` and Linux Fargate platform version 1.4.0 or later.
Do not equate regional prices or an On-Demand launch with ARM Spot placement.

1. Re-read account/region, service revisions, running image digests,
   platform version, actual capacity providers, network configuration,
   task-definition health checks, live security-group access, and lifecycle
   policies. Require one COMPLETED deployment, pending 0, and no concurrent
   release. Save the private baseline outside Git without printing secrets.
   Audit startup/background side effects **before registration or launch**.
   API needs fresh fixture credentials for a separate MySQL server for full
   worker tests; another schema or read-only account on production does not
   isolate the server-wide search lock. Remove every production DB/revision-
   key secret reference and use fresh fixture-only values supplied privately.
   If that prerequisite is unavailable, stop without launching API.
2. Clone each full current definition, strip AWS response metadata, and
   register an isolated candidate under a new family. Change only family,
   `runtimePlatform`, and image to the qualified ARM64 child digest. Preserve
   roles, resources, logs, environments and unrelated secret references where
   the reviewed service-specific isolation permits them. For API, construct
   an allowlisted temporary definition with the same image CMD and resource
   limits, existing execution role and log group, no task role or production
   secret references, and fresh isolated DB/revision-key credentials. Audit
   these controlled deviations instead of preserving production credentials.
   Any required new secret/IAM access needs its own precise authorization. Network
   configuration belongs to `run-task`; copy the service's subnets, security
   groups and public-IP setting separately rather than inventing new ones.
3. Only after the startup/isolation gate passes, run website/admin as
   standalone candidates with no service/discovery registration or router/DNS
   change. The separately reviewed paired API protocol may use exact owned
   temporary services in a new isolated cluster for standard ECS service
   metrics and rolling-worker tests; it adds no production service, load
   balancer, discovery or DNS registration. Keep its Container Insights
   explicitly disabled. Use On-Demand `FARGATE` for website/API. Test admin
   separately using **only `FARGATE_SPOT`**, with explicit weight 1; record
   the returned task's actual capacity provider, ARM64 architecture, image
   digest, exit status and placement failures. Do not silently substitute
   On-Demand for failed Spot placement. Immediate placement proves that
   attempt, not future Spot availability.
4. Probe the task's private IP from an authorized host in the VPC. Inspect
   router tools/access before depending on it. Prefer an existing strict-host-
   checked SSH tunnel bound to local loopback and run matching verifiers
   locally; the observed router has Python/curl but no Node. Do not install
   tooling or change Nginx merely to run the probes. If current SG access is
   insufficient, stop and present the precise additive rule and cleanup for
   approval rather than changing networking as an unstated prerequisite.
5. Run the qualification checks below with the already verified isolation.
   HTTP methods alone are not a write boundary. Read-only DB/API probes are permitted
   within the investigation scope. Admin write/revalidation testing needs an
   isolated test database and candidate website target, or separate explicit
   approval of the exact production mutation; cloning production credentials
   does not make a write test isolated.
6. Scale exact owned temporary API services to zero, wait for their workers
   to stop, and delete those services without force. Stop owned client/holder
   and database tasks, confirm STOPPED, then deregister and delete only their
   exact temporary task-definition revisions once INACTIVE; deregistration
   alone retains fixture credentials. Remove the journaled temporary seed
   manifest graph, prove the owned repository and cluster empty, and delete
   them without force. Record cleanup and preserve evidence/recovery images
   and logs. Do not delete production task definitions or images.

### Probe prerequisites and qualification gates

The appendix is a template, not a self-contained command that can be pasted
on an unprepared router. Use the exact source revision and matching canonical
recitation JSON/playback inventory for the candidate image. The probe host
needs the repository's supported Node/Python, the website dependencies that
provide `parse5` and `mysql2`, and access to the read-only DB endpoint.
`verify-public-content.mjs --database` reads **the probe process's `DB_URL`**;
ECS secret injection only provides it inside the task. Supply an authorized
read-only connection through process memory without logging/saving its value,
then clear it. Never copy a production `.env` or decrypted credential into Git.

Run website verifiers against port 3000, API requests against port 3003, and
admin requests against port 3101. API GraphQL is `POST /` on the candidate
endpoint; a request to public `api.<host>` does not exercise the candidate.
Preserve the expected Host/auth callback semantics when testing a private IP.
Website-specific `/api/health/ready` and recitation routes do not apply to
API/admin. Check public canonical redirects and legacy S3 image/audio
Range/CORS separately against the public origin; no candidate is publicly
routed. When a recitation verifier sends the private candidate origin as its
CORS `Origin`, compare that response with the unchanged production S3 policy;
a production-only allowlist cannot be made to accept the probe by loosening
CORS. Record the distinction between candidate metadata proof and public
asset compatibility proof.

| Gate | Required evidence before rollout |
| --- | --- |
| Build and architecture | Real per-service Linux/musl ARM64 image build succeeds with frozen lockfiles; inspect final ELF/native artifacts and image platform; capture source, index and child digests |
| Startup | At deployed CPU/memory limits, candidate starts within the existing packaged-image startup budget; no crash, OOM, secret-resolution or DB-connection error; website's three readiness routes pass |
| Website content | `verify-public-content.mjs --database` passes against the candidate with a real read-only corpus baseline; ready extension/chapter response bodies match the release's canonical data |
| Native image path | Actual bulletin illustration export produces a valid JPEG with expected dimensions/content; merely importing Sharp is insufficient |
| API/admin | Read-only GraphQL/DB responses and admin login/auth redirects match amd64; explicit readiness checks pass; controlled write/revalidation test is isolated or separately approved |
| Recitation and assets | Candidate version/metadata/canonical timings match; existing public playback, original MP3, MIME, byte-range and CORS checks pass without URL/policy changes |
| Capacity and performance | Record same-day amd64/ARM64 startup time, p50/p95 latency, peak memory and CPU under the same bounded representative replay; zero probe failures/OOMs, no resource-limit increase, candidate p95 no worse than the measured amd64 baseline |
| Admin Spot | An ARM64 task actually runs on FARGATE_SPOT at current limits; record placement/time and retain x86 Spot recovery; do not infer capacity from the On-Demand candidate |
| Recovery | Known-good amd64 manifest/layers are retained and pullable; a complete digest-pinned rollback task-definition request and provider/network baseline are prepared and privately verified |

Record measured values and run identifiers. A skipped check is unproven and
blocks the affected migration. A timeout is a failure to investigate, not a
reason to widen the existing timeout. Redact access-log personal data and
replay only reviewed read-only routes; do not replay production writes or
credentials. If Container Insights is not enabled, use available task metrics
or a separately approved measurement method rather than enabling a new paid
service as an implicit step.

## Canary rollout plan (phase 3+ - separate specific approval required)

Proposed order: admin, API, then website. Admin has accepted interruption
tolerance, but its native build and Spot placement must still pass. A
single-instance rolling replacement is not a percentage-based traffic canary.
The isolated qualification task provides the pre-production canary; a service
update is a production cutover requiring its own approval.

Before **each service**:

1. Complete every applicable qualification gate and settle/implement the
   steady-state release contract. Present the exact PR/current image and
   production changes, URL/backward-compatibility impact, cost and rollback
   for Dorad's approval. Preserve website/API On-Demand capacity and admin's
   approved Spot strategy; do not change shared defaults.
2. Prepare and verify a recovery definition pinned to the **running known-good
   amd64 digest**, preserving all other live fields. Ensure its image is
   retained for the entire rollout/recovery window. Save the full task,
   service/provider/network and public-probe baseline privately. A previous
   revision that says `:latest` is not a pinned rollback.
3. Confirm the actual service task definition has application readiness
   checks understood by ECS. Current reference API/admin definitions omit
   them. Without task/LB checks, ECS may count a RUNNING task healthy after
   40 seconds; `minimumHealthyPercent=100` does not prove HTTP readiness.
   Add and validate an approved readiness prerequisite, or design a separately
   approved guarded handover that retains the known-good task until private
   and public probes pass. Do not promise automatic protection from Docker
   `HEALTHCHECK`, Cloud Map, or `services-stable` alone.
4. Freeze overlapping releases for the bounded cutover, publish and inspect
   the complete index only when authorized, and wait for any event-triggered
   deployment to settle before the next service update. Verify both platform
   children, current tag and running digest. Register a full cloned ARM64
   migration revision pinned to the qualified ARM child, then update only
   the intended service. Keep minHealthy100/max200 and the current website
   readiness/drain behavior. No automatic retention protects an interrupted
   Spot task; that remains the accepted admin availability risk.
5. Observe handover continuously. Require one primary COMPLETED deployment,
   desired=running=1, pending=0, the expected task revision, actual ARM64
   image digest/provider, correct reported application version, clean logs
   and all candidate/public compatibility probes. Verify the old task stops
   and discovery refreshes. Cloud Map does not itself implement listener drain;
   retain the website launcher/stop-timeout behavior documented in
   [deployment readiness](deployment-readiness-2026-10-06.md).
6. Complete the approved transition from the temporary pin to the implemented
   steady-state release contract, explicitly verify its resolved ARM digest,
   then observe one normal release. Require its new expected application
   version **and changed ARM image digest** to serve through the full probes;
   a successful force-redeploy of the previous pinned image is not a release.
   Only then consider the next service.

### Rollback

- Stop further publication/cutover steps and use the **prepared digest-pinned
  amd64 recovery revision**, not an arbitrary previous revision that still
  points to `latest`. Verify its manifest/layers remain available before the
  update. Restore the captured provider strategy if it changed; a task
  definition does not contain that service setting. Keep all other service
  networking/discovery/resource settings intact.
- Update the intended service to that recovery revision, wait for one
  COMPLETED primary deployment, and verify the actual known-good digest,
  application version, provider, HTTP/auth, canonical/legacy URLs and asset
  behavior. Monitor throughout the transition; min-healthy is not an
  application-health guarantee without real ECS readiness checks.
- Do not re-point release/version tags as the default rollback. Tag changes
  can trigger the deploy handler and affect other release consumers. Any
  necessary tag repair needs explicit scope, complete manifest/children and
  verification of its effect before publication resumes.
- A recovery pin deliberately pauses automatic image updates. Record it and
  deliberately restore the approved normal-release contract only after the
  incident is resolved and the replacement image is requalified. Do not
  silently leave the force-only release path pinned.

### Guard conditions that stop a migration

- Pull/build/startup/readiness failure, unexpected digest/version, DB/secret
  error, OOM, latency regression or any public compatibility failure: stop
  and recover using the prepared pinned revision. Do not rely on min-healthy
  to retain an application that has no ECS-observed readiness check.
- Missing recovery image, retention evidence, qualification output, readiness
  protection, or steady-state release proof: migration stays blocked.
- ARM Spot placement fails: leave admin on x86 Spot. ARM On-Demand is a cost
  regression at these rates and needs a separate decision.

## Compatibility risks and open questions

| Risk / question | Status |
| --- | --- |
| ARM64 base/Bun indexes | Initial registry inspection found variants; capture exact digests again for the qualification build |
| Native dependency completeness | Lockfile availability is evidence only; SWC/Sharp and admin build bindings need real ARM builds and final-image inspection |
| Rust static musl on aarch64 | Package/upstream support exists; actual image build, ELF inspection and DB/GraphQL proof required |
| QEMU vs native ARM | Prefer native runners; record actual build duration rather than assuming emulation is adequate |
| Single-platform release tars | Preserve the amd64 asset contract; add ARM64 asset and compose complete index at publication |
| EventBridge | Tag filter matches latest; notifications are best effort, so verify observed deployment/digest |
| Steady-state releases | Force-only deployment cannot advance a digest pin; temporary pin exit or a new per-release revision deployer is mandatory |
| Readiness protection | Inspect live ECS checks; API/admin reference definitions have none, so minHealthy100 alone is insufficient |
| Fargate ARM64 / admin Spot | Published support/rates do not prove placement at the required region/subnets/provider |
| Rollback retention | Saved digest/revision alone is insufficient; live lifecycle preview and retrievable known-good image required |
| Probe host / DB_URL | Stage matching tools/data/dependencies and a separate read-only probe-process connection; no secrets in logs/Git |
| Private-DNS SSM endpoint | Keep it; qualified candidate must resolve current task secrets without networking changes |
| Public assets / URLs | Preserve legacy public S3 paths, MIME/Range/CORS and canonical/legacy redirects; no policy change to accommodate a private-IP probe |

## Read-only / candidate command reference

Templates use placeholders, an already selected authorized SSO profile, and
`il-central-1`. State reads are read-only. Registration, task launch/stop,
retention changes and service updates are writes requiring the applicable
explicit approval; this reference is not an instruction to apply them now.
Keep decrypted values out of command output and repository files.

```bash
# Read current identity/state, without retrieving decrypted secret values.
aws sts get-caller-identity
aws ecs describe-services --cluster bible-on-site-cluster \
  --services bible-on-site-website bible-on-site-api bible-on-site-admin \
  --region il-central-1

# Inspect the exact index and retained known-good image before any write.
crane manifest <acct>.dkr.ecr.il-central-1.amazonaws.com/bible-on-site:v<ver>
aws ecr describe-images --repository-name bible-on-site \
  --image-ids imageTag=v<ver> --region il-central-1
aws ecr get-lifecycle-policy --repository-name bible-on-site --region il-central-1

# Prepare a full candidate JSON privately from the live definition.
# Strip response metadata; change family, runtimePlatform, and image only.
aws ecs describe-task-definition --task-definition bible-on-site-website:<rev> \
  --region il-central-1 --query taskDefinition > /tmp/td.json
aws ecs register-task-definition \
  --cli-input-json file:///tmp/td-candidate.json --region il-central-1

# Website/API candidate: FARGATE means On-Demand, not Spot.
# API registration/launch is forbidden until its separate-server DB secret
# has passed the earlier startup-isolation gate; the production DB_URL is unsafe.
# Copy the actual service's network settings into the private network JSON.
aws ecs run-task --cluster bible-on-site-cluster \
  --task-definition bible-on-site-website-arm64-candidate:<rev> \
  --launch-type FARGATE --platform-version 1.4.0 \
  --network-configuration file:///tmp/candidate-network.json --region il-central-1

# Separate admin ARM Spot placement test; omit --launch-type.
aws ecs run-task --cluster bible-on-site-cluster \
  --task-definition bible-on-site-admin-arm64-candidate:<rev> \
  --capacity-provider-strategy capacityProvider=FARGATE_SPOT,weight=1 \
  --platform-version 1.4.0 \
  --network-configuration file:///tmp/admin-candidate-network.json --region il-central-1
aws ecs describe-tasks --cluster bible-on-site-cluster --tasks <candidate-task-arn> \
  --region il-central-1

# Website probes from a matching local checkout through an existing SSH tunnel.
# Bind the tunnel to loopback, keep strict host checking, and close it afterward.
# Requires local website dependencies and process DB_URL (read-only).
# Clear DB_URL after the probe; never print or save its value.
node web/bible-on-site/scripts/verify-public-content.mjs \
  --origin http://127.0.0.1:<forwarded-port> --database
python data/recitation/deployment.py --origin http://127.0.0.1:<forwarded-port> \
  --version <exact-image-application-version> --check-audio

# Recovery uses a separately prepared, known-good digest-pinned definition.
aws ecs update-service --cluster bible-on-site-cluster --service <svc> \
  --task-definition <family>:<pinned-amd64-recovery-rev> --force-new-deployment \
  --region il-central-1

# Candidate cleanup after capture (never target a production service task).
aws ecs stop-task --cluster bible-on-site-cluster --task <candidate-task-arn> \
  --reason arm64-qualification-complete --region il-central-1
aws ecs deregister-task-definition --task-definition <candidate-family>:<rev> \
  --region il-central-1
```

## Search-worker correctness fix and production impact

The investigation found that search retraining acquired and released a
session-scoped MySQL advisory lock through independent pool checkouts.
The follow-up fix retains one physical SQLx session and executes acquisition,
all existing retrain SQL, and release on it. Closing that session on drop
also covers cancellation during an in-flight statement; another worker cannot
start on a different session before the earlier statement has finished.
The real-MySQL regression covers contention, SQL errors, cancellation during
an active delayed write, typed blob parameters, and a one-connection pool.
It runs explicitly in the existing API coverage job and contributes its hits
to the unit report before the normal coverage merge.

This corrects serialization of the existing worker; it adds no schema,
canonical content, public URL, authentication, IAM, network, or ECS resource
change. Worker startup/write behavior remains enabled by default, which is
why candidate database isolation is still required. The direct
sea-query-sqlx dependency uses the exact binder version already frozen under
SeaORM; no dependency versions are upgraded.

Merging API source changes can ship a normal amd64 API release through the
existing CD path. It does not migrate any service to ARM. Before review, the
current API 0.1.93 amd64 image was pulled by its actual running digest,
privately archived with a checksum, and a complete cloned digest-pinned
recovery request was prepared without applying it. If recovery is needed,
register that request and restore the affected API service using the captured
configuration, then verify health/version and public probes. A rollback pin
must later be deliberately returned to the normal release contract.

## Dated investigation evidence

### 2026-10-28 authenticated read-only audit

The intended account and il-central-1 region were verified through the
existing SSO profile. Private raw snapshots were captured outside Git; no
production configuration was changed by this audit.

- Website/API/admin each had one COMPLETED deployment, desired/running 1
  and pending 0. Task revisions remained website:16, api:5 and admin:6.
  Their CPU/memory matched the cost table. Website/API were on FARGATE;
  admin used FARGATE_SPOT. Runtime architecture was unset (default X86_64).
- The live website task definition had an ECS health check; API/admin had
  none. The readiness prerequisite above is therefore a live migration gate,
  not merely a reference-template concern.
- Current latest tags were single-image Docker v2 manifests, not multi-arch
  indexes. No ARM image placement or routine ARM release was proven.
- Live ECR retention differs by repository: website has a count-based
  15-image expiry policy; API has no lifecycle policy; admin also expires
  beyond 15 images.
  Inspect and preview each actual policy before relying on rollback images;
  do not infer fleet-wide retention from the reference template.
- FARGATE and FARGATE_SPOT providers were ACTIVE and Container Insights was
  enabled. Neither observation proves ARM placement or acceptable resource use.
- The account had one running EC2 instance and no SSM-managed instances in
  this region. The proposed SSM router probe path was not available as
  described. Verify an existing private probe/tunnel path before launching
  candidates; do not add IAM, SSM registration or ingress as an implicit fix.
- Public price feeds were reread: all four on-demand and four Spot rates
  matched the table. At the live resource sizes, gross compute savings remain
  approximately $6.55/month, before small incremental image storage; the
  standard public-repository build runners are free.
- Local amd64 rehearsal built the real admin image and website dependency
  stage. Admin authentication redirect and unauthenticated server-function
  protection passed at 0.25 vCPU/512 MiB. Native SWC compilation and Sharp
  JPEG conversion passed at 0.25 vCPU/2048 MiB. These are amd64 checks, not
  ARM64 runtime evidence; native ARM execution remains a CI/candidate gate.

### 2026-10-28 native builds and isolated placement tests

[CI run 40655741226](https://github.com/bible-on-site/bible-on-site/actions/runs/40655741226)
passed all six native amd64/ARM64 legs: API/admin final images and website
SWC/Sharp dependency probes. Source merge revision was
`c69294b484cb28928f43a1208816a0f6d8781aa6`. Immutable Actions artifact ZIP digests
and the contained image archive checksums were verified before placement.
These results predate subsequent search-worker serialization hardening; its
final head must receive the same build checks.

Existing SSH key/host trust, forwarding and current task security-group
access were verified without changing IAM, SSM, Nginx or ingress. Baseline
website readiness/recitation, API health and admin auth probes passed. Local
loopback forwarding makes installing Node on the router unnecessary.

- Admin ARM64 actually placed on FARGATE_SPOT in 23.85 seconds at 0.25 vCPU
  and 512 MiB. Its login redirect and unauthenticated server-function response
  matched the live amd64 baseline. Two distinct Container Insights observation times (four task/container
  records) recorded a 22 MiB memory peak and 2.596/256 CPU units. This short auth/idle
  observation is not a representative-load benchmark or a full signed-in
  author-edit/revalidation test.
- API ARM64 placed on FARGATE in 23.50 seconds at the existing limits. Health
  was successful and a real article GraphQL read matched production. The
  strict version comparison failed: candidate 0.1.94 versus production
  0.1.93. Comparing the published 0.1.93 source with the tested merge found
  only the package version in Cargo.toml and Cargo.lock changed; API source,
  Dockerfile and dependency versions were identical. Preserve the failed
  exact-version result rather than relabeling it a complete migration pass.
- The API startup review then identified the background worker's write
  potential. Its captured application stream contains two SET statements,
  three CREATE TABLE IF NOT EXISTS statements and six SELECT statements;
  no INSERT/UPDATE/DELETE/REPLACE or retraining was observed. This is not a
  database audit trail or proof of zero side effects. Further API launches
  using production write credentials are blocked until the isolation
  prerequisite is met. No corrective production data writes were performed.
- Both candidates were stopped, their revisions deregistered and their
  separate temporary ECR repositories removed. The original services retained
  their task revisions, providers and stable counts. No production image tag,
  service, router, IAM, DNS or security-group setting was changed.

Regional private ECR standard storage was verified through the AmazonECR
price-list API at $0.10/GB-month. Each additional 10 GB of billed image storage
reduces the $6.55 gross monthly saving by $1; 20 GB would leave $4.55/month,
and 65.5 GB would consume the saving entirely. Retaining rollback histories
must take priority over shrinking the image count. Actual net savings still
need the full website ARM image size, measured retained/deduplicated layers
and any Actions artifact/cache storage charges. Current latest compressed
image sizes were about 1099.5 MiB website, 14.8 MiB API and 124.5 MiB admin;
summing image sizes is not an exact billed-storage measurement.

Production migration remains unqualified: normal multi-arch release delivery
and temporary-pin exit are not implemented; API/admin ECS readiness checks,
full website SSG/runtime, isolated API worker/full admin mutation tests,
representative comparative performance and retained/pullable rollback proof
remain required. A compatible ARM build and one successful Spot placement do
not remove these gates.

The initial report supplied repository/registry feasibility and published-rate
estimates. It contained no successful ARM64 application build, isolated AWS
candidate run, Spot placement measurement, production migration, or normal
ARM64 release-cycle proof. Add dated authenticated observations and validation
results here with their scope and remaining gates; never infer live proof
from a green docs-only CI run. Keep task snapshots, secrets and raw operational
records private. No production architecture change is authorized by this plan.

References: [#2562](https://github.com/bible-on-site/bible-on-site/issues/2562),
[#2576](https://github.com/bible-on-site/bible-on-site/issues/2576),
[cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md),
[admin-spot-rollout.md](admin-spot-rollout.md),
[ecs-services.yaml](cloudformation/ecs-services.yaml),
[ecr-ecs-auto-deploy.yaml](cloudformation/ecr-ecs-auto-deploy.yaml),
[AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/),
[ECR pricing](https://aws.amazon.com/ecr/pricing/),
[ECS task ARM64 runtime platform](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#runtime-platform),
[ECS health-check rules](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html),
[ECS deployment health semantics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html#deploymentConfiguration),
[Fargate capacity provider / ARM Spot requirements](https://docs.aws.amazon.com/cli/latest/reference/ecs/run-task.html),
[ECR EventBridge delivery](https://docs.aws.amazon.com/AmazonECR/latest/userguide/ecr-eventbridge.html).
