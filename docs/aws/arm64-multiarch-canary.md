# ARM64/Graviton multi-arch validation and canary plan (issue #2562)

Investigates ARM64/Graviton savings for the three ECS Fargate services —
website, API and admin — **without changing production behavior or breaking
rollback**, as required by
[#2562](https://github.com/bible-on-site/bible-on-site/issues/2562).
Follow-up from [#2576](https://github.com/bible-on-site/bible-on-site/issues/2576);
reference audit: [cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md).

**No production architecture/image/service change or AWS-related PR merge
without Dorad's explicit approval of the specific PR's current impact.
Auto-merge off.** This document is research only. No AWS credentials were
available for this pass (`aws sts get-caller-identity` returns
NoCredentials), so nothing below was applied to AWS: every "verified" claim
comes from repository code, published registry manifests or the published
AWS price list, and every live step is marked **[requires AWS access +
approval]**.

Production baseline from the 2026-10-23 audit (re-read live before any
approved step): account **250598594267**, region **il-central-1**, cluster
`bible-on-site-cluster`; services `bible-on-site-website` (task rev 16),
`bible-on-site-api` (rev 5), `bible-on-site-admin` (rev 6), each
desired/running 1. Website/API run on-demand `FARGATE`; admin runs
`FARGATE_SPOT` since 2026-10-24 ([rollout record](admin-spot-rollout.md)).

## What is already proven — image feasibility

### Every base image already ships linux/arm64

Verified by reading the registry manifests directly (anonymous Docker Hub
pull, `Accept: image.index`):

| Base image | Used by | linux/arm64 child |
| --- | --- | --- |
| `node:26.12.1-alpine` | website + admin (all stages) | yes (`arm64/v8`) |
| `oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a` | website + admin (`COPY --from` of the bun binary) | yes — the pinned digest is itself an **OCI index** containing `linux/amd64` and `linux/arm64`, so the pinned reference resolves per-architecture and does not smuggle an x86 bun into an ARM image |
| `rust:1.99.1-alpine` | API build stage | yes (`arm64/v8`) |
| `alpine:3.24.3` | API final stage | yes (`arm64/v8`) |

No `FROM` line, pinned digest or base-image pin needs changing to produce
arm64 builds.

### Native dependencies per service

| Service | Native surface | ARM64 assessment |
| --- | --- | --- |
| website (Next.js 16.4.3 standalone) | `sharp@0.35.5` is the only native module. Used in `src/lib/download/perek-export-content.ts` to resize/re-encode perek illustration JPEGs for bulletin export — no font rendering inside the container; fonts (`src/app/fonts/*.woff*`, `src/lib/download/fonts/*.ttf`) ship as bundled bytes | `bun.lock` already pins `@img/sharp-linuxmusl-arm64` and `@img/sharp-libvips-linuxmusl-arm64`, so `bun install --frozen-lockfile` inside an arm64 build resolves the musl-arm64 prebuilt binary. Runtime proof (real transcode output on the export path) is still required |
| admin (TanStack Start, Node) | none — `mysql2`, `@aws-sdk/*`, `jose`, `nitro`/TanStack and `tiptap` are pure JavaScript | Lowest-risk image; also the service that already tolerates interruption (Spot, one user) |
| api (Rust, musl static) | `actix-web`, `sea-orm`/`sqlx-mysql`, `tokio-native-tls` → `openssl-sys`; the Dockerfile links OpenSSL statically via `openssl-libs-static` | `openssl-libs-static` exists for aarch64 musl in alpine 3.24; `ring` in the lock graph has upstream aarch64 support. Compiling the identical Dockerfile inside an arm64 image build produces a native musl binary — **no cross-compile toolchain needed** |
| bulletin (Lambda ZIP, `web/bulletin/Dockerfile`) | same Rust musl pattern | Out of #2562 scope: the deliverable is a ZIP pushed through `cd-bulletin.yml`, not an ECS image. A musl aarch64 binary + Lambda `architectures: [arm64]` is a later, separately approved saving |

### Entrypoints are arch-neutral

- website: `node start-server.mjs` → `server.js` standalone bundle — pure JS.
- admin: `node .output/server/index.mjs` — pure JS.
- api: `/bin/server` musl static binary — produced per-arch by the same
  `cargo build --locked --release` inside the per-arch build stage.
- Container health checks use `curl` installed via `apk` in the runner
  stage — resolves to the arm64 apk package automatically.

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
4. sharp transcode correctness on the bulletin-export path (the one native
   module in the fleet).
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
figures (verified against the published rates here). Unchanged by
architecture: the 20 GB Fargate ephemeral storage (~$2.14/task/mo), public
IPv4, CloudWatch Logs, data transfer and ECR storage. **Admin caveat:**
ARM on-demand ($9.23) costs *more* than today's x86 Spot ($3.46) — admin
must migrate onto Spot ARM capacity, or the move is a cost regression.
ARM Spot capacity in il-central-1 is unproven until measured.

This is a modest saving. The honest expectation is ~$6.5/month of Fargate
compute, ~20% of that line — not a large bill change. The migration's cost
must justify its risk; that call is Dorad's per the approval rule.

## Pipeline changes needed (proposal — not wired by this document)

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
   Each arch produces its own
   `<image>-v<ver>-<arch>.tar.gz` release asset; the amd64 artifact name and
   contract are unchanged.
2. **Publish the index at deploy time.** `cd-aws.yml` pushes each arch tar
   via `crane push` to `v<ver>-amd64`/`v<ver>-arm64`, then composes the
   manifest list over already-pushed children —
   `crane index append -t <repo>:v<ver> -m <repo>:v<ver>-amd64 -m <repo>:v<ver>-arm64`
   and the same for `latest` (`docker buildx imagetools create` is the
   equivalent; crane is already installed in cd-aws). Pushing `latest` as
   an index still fires exactly one auto-deploy, and existing X86_64 task
   definitions resolve the amd64 child — production behavior is unchanged.
   `resume-image.mts`'s `PutImage` path also carries an index manifest
   (same-repo children already exist).
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

### Deployer code notes (hardening for the change, not blockers)

- `getRemoteImageTags` sorts every non-`latest` tag as a version; `deps-cache`
  already lands in that list today and degrades remote-version detection to
  "assume local is newer" (an invalid semver branch). Adding
  `v<ver>-amd64`/`v<ver>-arm64` tags keeps `semver.coerce` comparisons
  correct, but the deployer should filter to the `^v\d+\.\d+\.\d+$` release
  pattern when arch tags arrive so detection stays exact.
- ECR lifecycle "keep last 15 images" now retires a release roughly 3×
  faster (two children + index per release). Pinned rollback digests must
  be recorded privately per the admin-spot practice before relying on
  image-level rollback.

### Phasing that keeps `latest` amd64-only until approved

The safest sequencing: phase 1 ships per-arch builds + `v<ver>-<arch>`
tags only, leaving `v<ver>`/`latest` pointing at the amd64 image exactly as
today. The isolated ARM64 candidate then pins the `v<ver>-arm64` digest.
The index flip on `v<ver>`/`latest` lands only when a service is approved
to migrate — so the tag semantic changes at the moment it is actually
needed, not before. Both sub-phases keep amd64 published and prior digests
immutable.

## Isolated candidate design (phase 2 — [requires AWS access + approval])

Multi-arch manifests do **not** make ECS choose Graviton: task definitions
without `runtimePlatform` default to X86_64, and `runtimePlatform` cannot
be edited in place — a new task-definition revision carries it.

1. Re-read live state (account, service revisions, running digests, one
   COMPLETED deployment, pending 0) — the audit baseline is a snapshot, not
   evidence of current state.
2. `aws ecs describe-task-definition` the service's current revision; strip
   response metadata; register an **isolated candidate under a new family**
   (e.g. `bible-on-site-website-arm64-candidate`) changing only:
   - `runtimePlatform = { cpuArchitecture: "ARM64", operatingSystemFamily: "LINUX" }`
   - container `image` = `<repo>@sha256:<arm64-child-digest>` (pinned
     digest, never `latest`; a `v<ver>-arm64` tag is the readable alias of
     the same digest).
   Everything else — execution/task roles, awsvpc networking, CPU/memory,
   log configuration, health check, environment and every `Secrets:`
   ValueFrom — is cloned verbatim per the task-revision rule.
3. `aws ecs run-task` a standalone candidate task — **no service, no Cloud
   Map registration, no router/nginx change**. Probe it from the nginx EC2
   router host over the task's VPC-private IP via SSM Session Manager (the
   router already sits inside the VPC; no security-group or public-ingress
   change is needed). If router probing proves impossible, a temporary
   scoped SG rule for the probing host is the additive fallback.
4. Verification set — all existing tooling, already origin-parameterized
   (exact commands in the appendix; `--origin` takes the task's
   VPC-private endpoint, e.g. port 3000 for the website):
   - `verify-public-content.mjs --origin <candidate-origin> --database`
     (read-only DB paths)
   - `data/recitation/deployment.py --origin <candidate-origin>
     --version <v> --check-audio`
   - container health check (the Dockerfile HEALTHCHECK command) plus
     `/api/health/ready`, `/api/recitation`, `/api/recitation/2`
   - GraphQL reads against `api.<host>` routes for the API candidate;
     admin login/auth redirect + a revalidation round-trip for admin
   - a bulletin-export request exercising the sharp transcode
   - `verify-canonical-hosts.mjs` redirect matrix against the public
     origin (unchanged behavior proof — runs against production, since the
     candidate is not publicly routed).
   - Measure time-to-healthy, then replay a representative slice of the
     router access log against the candidate while sampling Container
     Insights CPU/memory; compare against an amd64 same-day baseline.
5. Tear down the candidate task after capture; leave no task, service or
   registry residue beyond the tagged images.

## Canary rollout plan (phase 3+ — per-service, each step separately approved)

Order: **admin → api → website**. Admin is already Spot with an accepted
interruption tolerance and a pure-JS image; the API is a single static
binary; the website is last — public traffic, SSG, the sharp path and the
largest surface.

For each service, one at a time, retaining on-demand FARGATE capacity
(admin stays on whichever Spot provider measured viable):

1. **Gate**: phases 1–2 complete and verified for that service; explicit
   approval of the specific change.
2. **Publish the index** for that repo's `v<ver>`/`latest` (amd64 +
   arm64 children; existing X86_64 task defs still resolve amd64).
3. **Register the migration revision**: clone the live task definition
   verbatim again, setting `runtimePlatform` ARM64 and pinning the arm64
   digest — same recipe as the candidate, now on the service's own family.
4. **Update the service** to the new revision. With
   `minimumHealthyPercent=100`/`maximumPercent=200`, the old amd64 task
   keeps serving until the arm64 task passes health checks; Cloud Map
   MULTIVALUE refresh then drains it — the same handover behavior as a
   normal image release.
5. **Verify beyond `services-stable`** (the audit's requirement): one
   primary deployment with `rolloutState=COMPLETED`, desired=running=1,
   pending=0, running task-definition revision is the candidate revision,
   container health + logs clean, reported application version correct,
   and the full public probe set (canonical/legacy URLs, recitation,
   image generation/export, S3 Range/CORS unchanged).
6. **Soak** at least one normal release cycle for that service — proving a
   routine release ships multi-arch end-to-end — before touching the next
   service.

### Rollback

- **Immediate**: `aws ecs update-service --cluster bible-on-site-cluster
  --service <svc> --task-definition <previous-amd64-revision>
  --force-new-deployment`. The prior revision is immutable and references
  its amd64 image; with min-healthy semantics the replacement is a normal
  redeploy, and any `latest` index still resolves the amd64 child for it.
- **If `latest` drift is implicated**: re-point `latest`/`v<ver>` to the
  amd64-only manifest (`PutImage`/`crane index`) — the digest is immutable
  and recorded at deploy time.
- **Private rollback record** per the admin-spot runbook: task JSON, image
  digests (candidate + rollback), service config and probe baselines kept
  outside Git before each service's step.

### Guard conditions that stop a migration

- arm64 child fails to pull, crashes, or fails health/readiness →
  automatic min-healthy retention keeps the amd64 task; roll back the
  revision.
- sharp export, SSM injection, DB or recitation probes fail on the
  candidate → fix in the image/CI, never in production config.
- ARM Spot placement fails for admin → keep admin x86 Spot (already the
  cheapest option); do not move admin to ARM on-demand for a regression.

## Compatibility risks and open questions

| Risk / question | Status |
| --- | --- |
| arm64 bun binary | Resolved — pinned `oven/bun` digest is an OCI index with an arm64 child |
| arm64 Node/Rust/Alpine bases | Resolved — verified in the registry indexes |
| sharp musl-arm64 | Lockfile-pinned; runtime transcode proof still required on the candidate |
| Rust `openssl-sys`/static musl on aarch64 | Same alpine packages exist for aarch64; needs a real build to confirm |
| QEMU vs native ARM builds | Native `ubuntu-24.04-arm` recommended; QEMU too slow for SSG/Rust routine gating |
| Manifest lists with the `docker` driver | Cannot `--load` multi-arch — per-arch artifacts + index-at-push is the design |
| `latest` EventBridge trigger | Index push under `latest` fires one deploy; `-<arch>`/`v<ver>` pushes never trigger |
| `runtimePlatform` omission | Unset silently stays X86_64 — must be explicit on every ARM64 revision |
| Fargate ARM64 in il-central-1 | Published rates strongly imply support; must be confirmed by real placement |
| ARM Spot capacity for admin | Unproven; x86 Spot is already cheaper than ARM on-demand — decide from measurement |
| ECR lifecycle vs rollback digests | ~3× faster churn — record pinned digests privately before relying on them |
| `deps-cache`/`type=gha` caches | Need per-arch refs/scopes or arm64 builds lose (or poison) the cache |
| Private-DNS SSM endpoint | Unchanged by architecture; candidate proves secret injection as a check, not a risk |
| Candidate public probes | Probed via router-in-VPC; no SG/DNS/router change in phase 2 |

## Read-only / candidate command reference

```bash
# Re-read live state before any approved step
aws sts get-caller-identity
aws ecs describe-services --cluster bible-on-site-cluster \
  --services bible-on-site-website bible-on-site-api bible-on-site-admin \
  --region il-central-1

# Inspect what a tag resolves to (index vs single-arch) after CI pushes
crane manifest <acct>.dkr.ecr.il-central-1.amazonaws.com/bible-on-site:v<ver>
aws ecr describe-images --repository-name bible-on-site \
  --image-ids imageTag=v<ver> --region il-central-1

# Clone -> candidate task definition (strip response metadata, add runtimePlatform)
aws ecs describe-task-definition --task-definition bible-on-site-website:<rev> \
  --region il-central-1 --query taskDefinition > /tmp/td.json
aws ecs register-task-definition --family bible-on-site-website-arm64-candidate \
  --cli-input-json file:///tmp/td-candidate.json --region il-central-1

# Isolated candidate task (no service, no Cloud Map, no router change)
aws ecs run-task --cluster bible-on-site-cluster \
  --task-definition bible-on-site-website-arm64-candidate:<rev> \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[<s>],securityGroups=[<sg>],assignPublicIp=ENABLED}' \
  --region il-central-1

# Candidate probes (run from the router host over the task's private IP;
# admin candidate uses :3101, api candidate :3003)
node web/bible-on-site/scripts/verify-public-content.mjs \
  --origin http://<task-private-ip>:3000 --database
python data/recitation/deployment.py --origin http://<task-private-ip>:3000 \
  --version <v> --check-audio

# Rollback a migrated service to its immutable amd64 revision
aws ecs update-service --cluster bible-on-site-cluster --service <svc> \
  --task-definition <family>:<previous-rev> --force-new-deployment \
  --region il-central-1
```

References: [#2562](https://github.com/bible-on-site/bible-on-site/issues/2562),
[#2576](https://github.com/bible-on-site/bible-on-site/issues/2576),
[cost-risk-audit-2026-10-23.md](cost-risk-audit-2026-10-23.md),
[admin-spot-rollout.md](admin-spot-rollout.md),
[ecs-services.yaml](cloudformation/ecs-services.yaml),
[ecr-ecs-auto-deploy.yaml](cloudformation/ecr-ecs-auto-deploy.yaml),
[AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/),
[ECS task ARM64 runtime platform](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#runtime-platform).
