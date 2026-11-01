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

Record the index digest separately from each platform-manifest digest. If ECS
reports the index digest, verify its exact bytes and unique native platform
descriptor against the actual task's runtime platform and qualified child.
Retain the reported value and that derivation; never label an index digest as
a directly reported child digest. Any unrelated digest or ambiguous platform
mapping fails qualification.

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
Capture the service deployment/revision and resolved image digest. The completed
source revision is an immutable recovery target even when its image URI says
`latest`; bind its recorded resolved digest to the verified old image. Keep a
separate native-child pin for recovery after a new deployment has completed.

## One API deployment owner

The current release workflow keeps deployment automation at the dispatch SHA
and checks out the immutable artifact source under `release-source`. Replaying
an older release must not replace current publication or handover safeguards.
Website post-deployment verification still runs from its exact release source,
with dependencies supplied by the current deployment tools.

Before activating this owner, validate and install only the separate
`GitHubActionsAPIHandover` inline policy documented in `github-oidc.yaml`, on
`GitHubActionsECRDeployRole`. Preserve the existing managed policy and SSG
ownership-read inline policy. Its new service writes address only this API;
task protection is limited to cluster tasks because IAM cannot scope those
task APIs by service. The coordinator independently verifies the exact API
service group, task ARN, architecture, image and lease ownership. Definition
registration is limited to the API family, Fargate and the existing 256/512
size. Role passing is limited to the existing execution role.

With no other API release running, disable only EventBridge rule
`ecr-push-bible-on-site-api`. The API CLI refuses to publish while that rule is
enabled. Website and admin retain their existing triggers and Lambda settings.
Do not deploy either reconstructed infrastructure stack for this change.

The API publisher prepares the immutable fallback, checks both public aliases,
and protects the exact healthy source task before moving ECR `latest`. It then
explicitly updates the API service. An already-published release can therefore
finish its runtime rollout without rewriting an immutable canonical tag.

The temporary protection lasts 15 minutes as an expiration safeguard; it is
never renewed and does not extend deployment deadlines. A unique task tag and
the grant's exact whole-second expiration bind cleanup to this run. Existing
protections and foreign tags remain untouched. AWS can acknowledge a legacy
task ARN and return fractional expiration seconds while subsequent reads use
the long ARN and whole seconds; normalize only those verified observations.
An uncertain grant is preserved for investigation rather than cleared blindly.

## Switch architecture and retain release continuity

Register the otherwise equivalent ARM64 definition against the qualified
immutable ARM child. Update only the existing API service. Observe actual
container readiness, completed rollout, task architecture and resolved digest,
Cloud Map registration and the handover through both existing public aliases.
Retain the existing response deadlines and compare the full public contracts.
Never treat `RUNNING` alone as application readiness.

Keep the source protected until the replacement is healthy in ECS and Cloud
Map, and all four public health/readiness routes across both aliases have
reached its opaque `x-tanahpedia-instance` process marker. The marker contains
no AWS identifiers and leaves the health JSON unchanged. Observe this stable
visibility for the existing 10-second DNS TTL plus 10-second router cache
before releasing the old task. Cloud Map registration alone does not prove
that the router can already discover the replacement.

Require the old task to stop, one completed deployment and only the new healthy
Cloud Map address, then observe another cache window and repeat all 14 public
contract checks. Keep 30 seconds from AWS task start for readiness, 180 seconds
from replacement observation for ECS completion and 300 seconds overall.
Public health, readiness and 929 chapter identities are sampled at one request
per second, with a 2-second whole-request deadline and no retries. Reuse verified
TLS connections and authoritative DNS TTLs; never increase deadlines to hide
client-side DNS/TLS setup or a real 502. Save the complete pass/failure journal
as the workflow's API handover artifact, without task-definition secrets.

After the pinned ARM deployment passes, restore the ordinary ARM task
definition's image reference to the verified multiarch `latest` index and
verify its completed rollout and exact ARM child again. Leave multiarch
publication enabled for subsequent ordinary API releases. A permanent pin
would silently freeze those releases; switching architecture is incomplete
until that normal release path is preserved and verified.

## Rollback

On a rollout or public-contract failure, initiate control-plane recovery before
requiring a fresh healthy public baseline. For an ongoing deployment, verify
the recorded source revision's definition and immutable image, then request
ECS rollback to that revision. For a completed deployment, protect the exact
replacement while restoring the saved old native-child pin, and apply the
same discovery/public visibility window before retiring it. Verify actual
digest, readiness, completed singleton, discovery and public contracts. Keep
every failed sample in the original journal even when recovery succeeds.
Circuit-breaker rollback also needs a completed target; inspect its real
target and outcome. Floating `latest` alone does not guarantee a recovery image.

The November 1 API 0.1.100 ARM attempt exposed the reason for this protocol:
the router still used the retired x86 address before ARM discovery was visible,
causing a real public 502. The ARM task itself stayed healthy and exited cleanly
on recovery. X86 was restored, and a subsequent protected x86 `latest` handover
passed all 247 public samples and all 14 contracts. These observations validate
the handover mechanism, not completion of the ARM migration or qualification of
a later binary.

Before the first index is published, restoring the previous publication flag
can abandon the planned mode change. Once `latest` is an index, keep
`API_MULTIARCH_RELEASES=true`: the publisher deliberately rejects subsequent
single-platform releases, including fresh versions. Returning the service to
x86 still works through the index's x86 child. Repair or revert publisher code
while preserving dual-platform publication. Retain immutable release artifacts
and never rewrite an existing canonical version as rollback.

AWS documents the [container health-check behavior](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_HealthCheck.html),
[completed-deployment circuit-breaker target](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
and [immutable service revisions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-revision.html).
See also [task protection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html),
[stopping a service deployment with rollback](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopServiceDeployment.html)
and [service deployment permissions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-deployment-permissions.html).

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
