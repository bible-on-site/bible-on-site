# Admin ARM64 release delivery

Production admin runs ARM64 on Fargate Spot. Its ECR EventBridge rule
deploys `bible-on-site-admin:latest`. The current service configuration is in
the [AWS architecture guide](architecture/aws-architecture.md).

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

Production sets `ADMIN_MULTIARCH_RELEASES=true`. The canonical `v<version>`
and `latest` tags point to an OCI index over both verified children. Once
`latest` is an index, every subsequent release requires both native archives
and index publication. The publisher rejects a single-platform overwrite of an
immutable release version or a downgrade of `latest`.

## ECR policy

The admin ECR repository uses `IMMUTABLE_WITH_EXCLUSION` with exactly `latest`
mutable. The publisher requires this policy before publishing a dual-platform
index. The policy tool's `--verify` mode reads the live settings and checks the
caller account, region, registry, repository, and tag exclusion policy.
[Policy verifier](../../devops/deploy/ecr-deploy/admin-repository-policy.mts)

## Rollback and qualification

Before an approved architecture change, record the current task definition and
a known-good immutable image reference. The ECR lifecycle policy protects the
newest image tagged with the `rollback-admin-arm64-x86-` prefix, ahead of the
general 15-image policy. Verify that the exact rollback image remains
available. Keep index publication enabled while running ARM64.

Qualify changes to image architecture or capacity on isolated tasks. Exercise
Cognito sign-in, bulletin document reads, and authenticated editing with
disposable data. Preserve the current capacity provider, resources, IAM roles,
secret mappings, discovery, and rollout settings when changing architecture.
