# API ARM64 cutover

Keep the API at 256 CPU units, 512 MiB and one desired task. Preserve its
environment, SSM references, execution role, ports, network configuration,
Cloud Map registration and both public API aliases. This procedure changes no
database content, public asset URLs, DNS records or router configuration.

The CloudFormation template records the intended steady state: Linux ARM64,
the ordinary `latest` image, readiness-based container health and deployment
circuit-breaker rollback. Do not apply the reconstructed infrastructure stack
as a substitute for a scoped update to the existing API service.

## Qualify the actual release

Bind both published archives and immutable ECR child manifests to the same
published source and package version. Verify their platform, non-root user,
command, source/version labels and archive-to-registry identity. Exercise both
native architectures on a disposable MySQL server with the frozen public
corpus and synthetic write fixtures. Keep the existing 30-second readiness,
2-second request, zero-retry and resource limits.

Include complete persisted model/document/vector/term comparisons, query
ranking and scores, cold initialization, held-lock snapshot reuse, queued
synthetic updates and database-outage readiness. Alias management requires a
fresh valid key and an isolated website callback: test successful writes,
stale-editor rejection, disambiguation, removal, deletion and failed
post-commit invalidation. A failed invalidation must remain visible while the
write remains committed. Never send these fixture writes to production.

Historical measurements qualify their recorded binaries and inputs. A later
release needs its own artifact/provenance checks. Any narrowly justified
version-only transfer must identify every changed build input and verify the
new version over HTTP; a matching version label alone is insufficient. Do not
repeat the already consumed isolated 180-second rolling research trial.

## Prepare publication and recovery

Use a new immutable release version for the first canonical multiarch index.
An existing immutable single-platform version must not be overwritten.
Before enabling `API_MULTIARCH_RELEASES`, verify both native children and the
publisher's index collision, platform, source, format and freshness gates.
Keep x86 in production during index publication and verify the actual running
x86 child plus both public aliases afterward.

Before any architecture change, retain a full private copy of the current
healthy x86 task-definition registration fields and its exact resolved image
digest. Do not put secret values or that private definition in Git. Prepare
the ARM candidate and rollback requests before entering the cutover window.
Keep normal releases following `latest` while prerequisites are pending.

Within the coordinated cutover window, register the otherwise equivalent
x86 definition pinned to its verified immutable child and add the readiness
check shown in the template. Enable circuit-breaker rollback on the existing
API service, retaining minimum healthy 100% and maximum 200%. Deploy and
verify a **completed** healthy pinned x86 deployment before proceeding. A
saved request or registered definition is not a completed recovery target.
Capture the service deployment/revision and resolved image digest.

## Switch architecture and retain release continuity

Register the otherwise equivalent ARM64 definition against the qualified
immutable ARM child. Update only the existing API service. Observe actual
container readiness, completed rollout, task architecture and resolved digest,
Cloud Map registration and the handover through both existing public aliases.
Retain the existing response deadlines and compare the full public contracts.
Never treat `RUNNING` alone as application readiness.

After the pinned ARM deployment passes, restore the ordinary ARM task
definition's image reference to the verified multiarch `latest` index and
verify its completed rollout and exact ARM child again. Leave multiarch
publication enabled for subsequent ordinary API releases. A permanent pin
would silently freeze those releases; switching architecture is incomplete
until that normal release path is preserved and verified.

## Rollback

On a rollout or public-contract failure, restore the saved pinned healthy x86
task definition on the same service and verify its actual digest, readiness
and public contracts. Circuit-breaker rollback also requires a previously
completed deployment; inspect its real target and outcome. Do not claim that
floating `latest` guarantees a particular recovery image.

If multiarch publication itself needs reversal, keep the existing immutable
children/index, return publication to x86 mode for a fresh future version and
verify that version before moving `latest`. Do not delete immutable release
artifacts or rewrite an immutable canonical version as rollback.

AWS documents the [container health-check behavior](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_HealthCheck.html),
[completed-deployment circuit-breaker target](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
and [immutable service revisions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-revision.html).

## Compute estimate

The [official regional price offer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/il-central-1/index.json)
captured on November 1, 2026 was published October 19, with rates effective
October 1. For one Linux On-Demand task at 0.25 vCPU and 0.5 GiB over 730 hours:

| Architecture | USD per vCPU-hour | USD per GiB-hour | Monthly compute estimate |
| --- | --- | --- | --- |
| x86 | 0.05181440 | 0.00568960 | $11.53 |
| ARM | 0.04145152 | 0.00455168 | $9.23 |

The estimated compute reduction is $2.31 per month (20%). This excludes public
IPv4, logs, networking, database charges, discounts and taxes. It describes
list-price compute at the preserved size, rather than an observed account bill.
