# Admin ARM64 release delivery

Status: repository-only preparation; no production architecture, registry
policy, publication flag or service change has been applied. The live admin
service still runs x86 on FARGATE_SPOT. Merge is permitted because this change
only prepares the delivery path, but every AWS-side step below requires Dorad's
approval of that specific change under the root `AGENTS.md`.

## Baseline and intended scope

The admin service `bible-on-site-admin` on cluster `bible-on-site-cluster` runs
one x86 task at 0.25 vCPU / 0.5 GB on FARGATE_SPOT, deployed by the admin ECR
EventBridge rule following `bible-on-site-admin:latest`. Cognito-backed editing
is production data; the anonymous bulletin-document endpoint serves published
PDFs from MySQL.

This delivery is admin-only. Website, API, bulletin, data, RDS, Cognito, IAM,
networking, the router and public/crawled URLs are outside its scope. Preserve
the existing Spot capacity provider, resources, roles, secret mappings,
discovery and rollout settings exactly. Switching the admin task from x86 Spot
to ARM on-demand capacity is a separate cost/availability decision and is not
proposed here; ARM Spot placement is likewise unqualified and remains a later
AWS decision.

## Native build and release contract

Both native runners build the same admin Dockerfile and source version from the
same CI run: `package_admin` on the amd64 runner and `package_admin_arm64` on
the native `ubuntu-24.04-arm` runner, each with its own `admin`/`admin-arm64`
build cache scope. Every packaged image must pass the native verifier before it
is stored: genuine runner architecture, Linux image metadata, runtime
`uname`, Cognito SSO redirect and server-function protection probes, plus a
real read of a seeded bulletin PDF through the anonymous document endpoint
against the verifier-owned disposable MySQL server — never production data.

The amd64 archive retains its existing name
`bible-on-site-admin-v<version>.tar.gz`; the ARM64 archive adds
`bible-on-site-admin-v<version>-arm64.tar.gz`. The release job requires both
package jobs to succeed with the same nonempty version; a failed, skipped or
cancelled ARM build, a missing archive, or a source/version mismatch fails
closed and produces no release. Published release provenance binds both
artifacts to the exact source CI run, source commit, module and version.

On deploy, `check-deployment` emits `admin_arm64` only when published
provenance proves the immutable artifact pair of the current CI run. The CD
job then re-downloads both archives, verifies their SHA256 digests, lengths and
source binding, and hands the deployer the verified pair. Verified native
images receive immutable `v<version>-amd64` and `v<version>-arm64` tags.

`ADMIN_MULTIARCH_RELEASES` defaults to `false`. With it unset, canonical
`v<version>` and `latest` still resolve to the verified amd64 child — identical
to today's single-platform publication — so existing x86 tasks and the
EventBridge-triggered rollout are unchanged. With the reviewed flag set to
`true`, canonical and `latest` publish a complete OCI index over both verified
children. Once `latest` is an index, every subsequent release requires both
native archives and index publication; the publisher refuses index downgrade,
single-platform overwrite of an immutable version, and `latest` downgrade.

## AWS prerequisites before the first dual-platform release

The `bible-on-site-admin` ECR repository is currently `MUTABLE`. The publisher
refuses the dual path until it uses `IMMUTABLE_WITH_EXCLUSION` with exactly
`latest` mutable, matching the API contract; the reference template in
`cloudformation/ecr-repositories.yaml` documents that target only. Record the
live policy before changing it for rollback, apply the scoped change within
Dorad's approval, then enable `ADMIN_MULTIARCH_RELEASES` and let an ordinary
release publish the pair — a fresh release version only, never an overwrite of
an existing immutable tag.

The scoped repair for that prerequisite is `bun run deploy:admin-ecr-policy`
from `devops/` (`--verify` is read-only; `--rollback` restores the recorded
`MUTABLE` baseline). Every path first proves the caller through STS with the
same credentials the ECR client uses — a supplied `AWS_ACCOUNT_ID` is only a
hint — and refuses to run outside account `250598594267` / region
`il-central-1`; every ECR call also names that account as `registryId` and the
returned repository identity is validated. It only writes
`PutImageTagMutability` on `bible-on-site-admin`, only after the live policy
matches the recorded baseline or already converged target, and re-verifies
the result through the publisher's own `assertAPIRepositoryPolicy` guard. Any
other observed live state refuses the transition.

## Rollback prerequisites

Before any AWS-side change, record the previous registry mutability/lifecycle
policy, the current `latest` digest and the healthy x86 task definition
(privately; never in Git). Index activation is not itself a cutover: x86 tasks
keep selecting the amd64 child inside the index. Rolling back the flag while
`latest` is an index is refused by the publisher; recovery restores recorded
x86 state rather than rewriting tags. The admin lifecycle rule retains only
the newest 15 images, so retain an immutable x86 fallback tag if the reviewed
cutover ever needs one.

## Later qualification work (Codex/AWS, isolated data only)

- ARM runtime qualification on isolated capacity: Cognito sign-in, bulletin
  document reads, and authenticated editing flows — always against isolated
  data, never production writes.
- ARM Spot placement evaluation and, only if separately approved, any
  on-demand/Spot capacity change.
- Applying the ECR policy and `ADMIN_MULTIARCH_RELEASES` flag described above,
  then the eventual service architecture update itself.

This document describes the eventual admin-only proposal; the repository
change does not perform or authorize any of it.
