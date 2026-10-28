# ARM64/Graviton multi-arch validation and canary plan (issue #2562)

Investigates ARM64/Graviton savings for the three ECS Fargate services —
website, API and admin — **without changing production behavior or breaking
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
| `oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a` | website + admin (`COPY --from` of the bun binary) | yes — the pinned digest is itself an **OCI index** containing `linux/amd64` and `linux/arm64`, so the pinned reference resolves per-architecture and does not smuggle an x86 bun into an ARM image |
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

## What still needs proof on actual ARM hardware

Registry and code inspection cannot substitute for the issue's required
runtime verification. **Unproven until phase 2 below runs:**

1. Startup/readiness on Graviton under the deployed limits (0.25 vCPU;
   2048 MB website, 512 MB api/admin), including the website's cold
   canonical-data load that caused the 2026-10-06 handover stalls
   ([record](deployment-readiness-2026-10-06.md)).
2. SSM `Secrets:` resolution at task start (`DB_URL`, `REVALIDATE_SECRET`,
   `INDEXNOW_KEY`) and networking via the live private-DNS SSM endpoint —
   unchanged in principle (secret injection is execution-role + endpoint
   work, not ISA work) but must be observed on the candidate task.
3. DB/API behavior: GraphQL queries against `tanah-mysql`, website dynamic
   pages/ISR, admin session/auth flow.
4. sharp transcode correctness on the bulletin-export path, plus successful
   native build tooling and a recorded final-image native artifact inventory.
5. Public content: canonical/legacy URL matrix, recitation content and
   playback, image/audio Range+CORS — the same probe set the audit and
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
| On-demand vCPU | 0.0518144 | 0.04145152 | **−20.0%** |
| On-demand GB | 0.0056896 | 0.00455168 | **−20.0%** |
| Spot vCPU | 0.01554432 | 0.01243546 | **−20.0%** |
| Spot GB | 0.00170688 | 0.0013655 | **−20.0%** |

Monthly compute (730 h) per service at current sizes:

| Service | Size (vCPU/GB) | Today | On ARM64 | Delta/mo |
| --- | --- | --- | --- | --- |
| website | 0.25 / 2 | $17.76 on-demand | $14.21 on-demand | **−$3.55** |
| api | 0.25 / 0.5 | $11.53 on-demand | $9.23 on-demand | **−$2.31** |
| admin | 0.25 / 0.5 | $3.46 Spot x86 | $2.77 Spot ARM *if* ARM Spot placement works | **−$0.69** |
| **Total Fargate compute** | | **$32.75** | **$26.21** | **−$6.54 (−20%)** |

The math method is the same one that produced the audit's $11.53/$3.46
figures (verified against the published rates here). The default **20 GB
of Fargate ephemeral storage is included at no additional charge**; only
configured storage above that allowance is billed. Architecture does not
change that allowance or public IPv4, CloudWatch Logs, and data-transfer
pricing. Publishing additional image children can increase ECR storage and
build costs, so $6.54 is the gross compute saving, not a guaranteed net bill
reduction. See [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/).
**Admin caveat:**
ARM on-demand ($9.23) costs *more* than today's x86 Spot ($3.46) — admin
must migrate onto Spot ARM capacity, or the move is a cost regression.
ARM Spot capacity in il-central-1 is unproven until measured.

This is a modest saving. The honest expectation is ~$6.5/month of Fargate
compute, ~20% of that line — not a large bill change. The migration's cost
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
  containerd image store. Per-architecture builds are therefore required —
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
   fallback — viable for the small admin/API images, too slow to be the
   routine path for the Rust release build and the SSG website build.
   Preserve `<image>-v<ver>.tar.gz` as the amd64 release asset and add
   `<image>-v<ver>-arm64.tar.gz` for ARM64. Update every producer/consumer
   together; renaming the amd64 tar would break the existing release contract.
2. **Publish the index at deploy time.** `cd-aws.yml` pushes each arch tar
   via `crane push` to `v<ver>-amd64`/`v<ver>-arm64`, then composes the
   manifest list over already-pushed children —
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
   master-push-only for its DB-backed SSG build — its arm64 variant runs
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
to migrate — so the tag semantic changes at the moment it is actually
needed, not before. Both sub-phases keep amd64 published. Digests identify
immutable content, but the retention prerequisite above is what preserves
that content for recovery.

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
2. Clone each full current definition, strip AWS response metadata, and
   register an isolated candidate under a new family. Change only family,
   `runtimePlatform`, and image to the qualified ARM64 child digest. Preserve
   roles, resources, logs, environments and every secret reference. Network
   configuration belongs to `run-task`; copy the service's subnets, security
   groups and public-IP setting separately rather than inventing new ones.
3. Run a standalone candidate with no service/discovery registration and no
   router/DNS change. Use On-Demand `FARGATE` for website/API. Test admin
   separately using **only `FARGATE_SPOT`**, with explicit weight 1; record
   the returned task's actual capacity provider, ARM64 architecture, image
   digest, exit status and placement failures. Do not silently substitute
   On-Demand for failed Spot placement. Immediate placement proves that
   attempt, not future Spot availability.
4. Probe the task's private IP from an authorized host in the VPC. Inspect
   router tools/access before depending on it; install/stage the verifiers
   and their dependencies without changing Nginx. If current SG access is
   insufficient, stop and present the precise additive rule and cleanup for
   approval rather than changing networking as an unstated prerequisite.
5. Run the qualification checks below. Read-only DB/API probes are permitted
   within the investigation scope. Admin write/revalidation testing needs an
   isolated test database and candidate website target, or separate explicit
   approval of the exact production mutation; cloning production credentials
   does not make a write test isolated.
6. Stop candidate tasks, confirm STOPPED, deregister their temporary candidate
   revisions, and record cleanup. Preserve required image evidence/recovery
   artifacts and logs. Do not delete production task definitions or images.

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

# Website probes on the prepared VPC probe host, from the matching checkout.
# Requires installed website dependencies and process DB_URL (read-only).
# Clear DB_URL after the probe; never print or save its value.
node web/bible-on-site/scripts/verify-public-content.mjs \
  --origin http://<task-private-ip>:3000 --database
python data/recitation/deployment.py --origin http://<task-private-ip>:3000 \
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
  15-image expiry policy; API has no lifecycle policy; admin has a policy.
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
  approximately $6.54/month, before extra image storage/build overhead.
- Local amd64 rehearsal built the real admin image and website dependency
  stage. Admin authentication redirect and unauthenticated server-function
  protection passed at 0.25 vCPU/512 MiB. Native SWC compilation and Sharp
  JPEG conversion passed at 0.25 vCPU/2048 MiB. These are amd64 checks, not
  ARM64 runtime evidence; native ARM execution remains a CI/candidate gate.

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
[ECS task ARM64 runtime platform](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#runtime-platform),
[ECS health-check rules](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html),
[ECS deployment health semantics](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html#deploymentConfiguration),
[Fargate capacity provider / ARM Spot requirements](https://docs.aws.amazon.com/cli/latest/reference/ecs/run-task.html),
[ECR EventBridge delivery](https://docs.aws.amazon.com/AmazonECR/latest/userguide/ecr-eventbridge.html).
