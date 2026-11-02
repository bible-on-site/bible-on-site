# Admin-only Fargate Spot rollout

Completed 2026-10-24; see the live verification record below. Deploy the
atomic family-save fix first. The current live outcome and rollback evidence
are recorded in [the implementation issue #2576](https://github.com/bible-on-site/bible-on-site/issues/2576)
and its linked rollout updates. This reference configuration is not evidence
that AWS has changed; consult the latest explicit verification record.

Dorad explicitly requested login and admin optimization after clarifying that
admin currently has one user and some downtime is acceptable for cost savings.
This supersedes only the admin availability decision in the
[2026-10-23 audit](cost-risk-audit-2026-10-23.md). Public website/API availability,
existing public links, data integrity and explicit approval of AWS PRs remain
required. This request authorizes the scoped live admin change; it does not
approve merging an unseen AWS PR.

## Scope and savings

Use one admin task on FARGATE_SPOT, with manual recovery to FARGATE if needed.
Do not change public website/API capacity, shared cluster defaults, router,
DNS, S3 policies, IAM, SSM endpoints, authentication or task networking. Do not
create an always-running fallback task or infer a shutdown schedule.

At current Israel Linux x86 rates, 0.25 vCPU / 0.5 GB for 730 hours/month costs
approximately **$11.53 on-demand versus $3.46 Spot**, saving **$8.07/month in
compute**. Pricing varies; this is not a reduction of the entire AWS bill.
Public IPv4, logs, transfer, image storage and shared resources are separate.
Sources: [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/),
[on-demand rates](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ecs/USD/current/ecs.json),
[Spot rates](https://dftu77xade0tc.cloudfront.net/fargate-spot-prices.json).

AWS sends a two-minute Spot interruption warning. Replacement capacity may be
unavailable for longer; **AWS does not automatically fall back to on-demand**.
A weighted provider strategy is not failover. An operator must use the recovery
path below if the outage is unacceptable.
[Capacity-provider behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html).

## Data-safety prerequisite

The review found multi-statement family-tree saves using separate autocommits.
An interrupted create/update/delete could leave partial logical content. The
prerequisite fix runs each multi-write mutation on one existing MySQL
transaction connection, including its dependent lookups/helpers. Website
invalidation runs only after commit. Failure injection must prove that late
failures roll back and do not invalidate public content.

The current locked Nitro/srvx runtime handles SIGTERM and drains HTTP requests,
but its drain allowance is finite. Do not rely on shutdown timing to make a
multi-write logical mutation atomic. Do not increase timeouts to hide the
problem. Persisted DB/S3 data remains external to the disposable task; unsaved
browser work and interrupted requests are not guaranteed to survive.

Deploy and verify this application fix through the normal release path before
starting the capacity migration. No production write is needed just to test
transaction rollback; use isolated tests. Do not claim all other writes or all
failure modes are covered by this scoped fix.

## Preflight and private rollback record

1. Verify SSO account/region against the intended existing profile. Keep exact
   account/resource identifiers, task JSON, image digests, secret references
   and rollback snapshots private, outside Git. Never retrieve decrypted
   secrets for the capacity change.
2. Snapshot full cluster provider associations and exact default strategy;
   admin service, task definition, running tasks/digest, networking, roles,
   env/secrets references, discovery registry, resources and rollout settings;
   and website/API service/task state. Confirm one stable admin task, desired 1,
   pending 0, a single COMPLETED deployment and no overlapping release.
3. Record baseline public readiness, API health, both admin authentication
   redirects, representative legacy redirects and S3 image/audio Range/CORS.
4. Preserve the current application image. The force-only ECR deployer uses
   the task definition's mutable latest tag for future releases. Permanently
   pinning that task definition would freeze normal deployment updates.
   Instead, require current ECR latest to equal the running image digest
   immediately before this provider-only migration and verify the replacement
   digest. Prepare a private cloned task-definition request pinned to the
   known-good digest for recovery if tag drift is detected. Do not change the
   task definition during the normal provider-only switch.
5. Read current region support using DescribeCapacityProviders. Both FARGATE
   and FARGATE_SPOT must be ACTIVE. Published support does not prove immediate
   capacity; retain the working task until replacement is healthy.

## Scoped migration

1. Add FARGATE/FARGATE_SPOT associations **additively**, preserving every
   existing association and the exact cluster default strategy (including an
   empty array). PutClusterCapacityProviders replaces both lists. Do not set
   Spot as a shared cluster default.
2. Recheck admin state, image digest and absence of concurrent deployments.
   Update only admin to `capacityProvider=FARGATE_SPOT,weight=1`, with forced
   new deployment. Strategy change alone does not deploy. Preserve desired 1,
   minHealthy100/max200, task revision and all other service configuration.
3. Observe replacement placement and image digest. On mismatch, placement
   failure or unhealthy startup, return admin to on-demand using the private
   known-good definition/digest if necessary. Do not leave a stuck rollout or
   silently accept a different application image.
4. Check real public admin HTTP/auth behavior during overlap and after the old
   task is STOPPED and discovery/DNS has refreshed. Without container/ELB
   readiness checks, ECS RUNNING/stable alone does not prove HTTP health.
5. Confirm one primary COMPLETED deployment, desired/running 1, pending 0,
   actual FARGATE_SPOT provider and expected digest. Compare task/service
   configuration to the private baseline, permitting only expected provider,
   task identity/timestamps and deployment metadata differences.
6. Recheck public website/API configuration, counts, readiness, canonical and
   legacy routes, and image/audio Range/CORS. Do not fix unrelated shared
   production configuration as part of this rollout.

References: [cluster provider replacement semantics](https://docs.aws.amazon.com/cli/latest/reference/ecs/put-cluster-capacity-providers.html),
[service update semantics](https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html).

## On-demand recovery

With the authorized SSO profile and intended region already selected:

```powershell
aws ecs update-service --cluster bible-on-site-cluster --service bible-on-site-admin --capacity-provider-strategy capacityProvider=FARGATE,weight=1 --force-new-deployment --profile <AUTHORIZED_PROFILE> --region il-central-1
```

Use the same verified current task definition when the image is unchanged.
If image drift caused the failure, first register the private pinned-image
rollback request, preserving all fields except AWS response metadata, and
select that revision in the service update. Record the temporary pin and restore
the normal release image contract deliberately before subsequent releases.
Never silently leave the force-only release path pinned.

Wait for replacement and verify provider FARGATE, expected digest, admin HTTP,
authentication routing, one COMPLETED deployment and healthy public services.
Do not remove shared provider associations used by other services. This is an
operator recovery action, not an automatic availability guarantee.

## Validation before publication

- 730 admin unit tests pass, including 20 new stateful failure/commit tests
  using the real transaction helper with a simulated MySQL driver. This is
  fault injection, not a destructive production interruption test.
- Full admin unit line coverage is 99.17%; changed family mutation code is
  fully covered. Production build, TypeScript and focused Biome checks pass.
- Repository hooks, secret/link checks, reference-template AWS syntax
  validation and an admin-only capacity/default guard pass.
- Independent read-only review found no transaction connection leak or
  invalidation-before-commit path. The fix does not make revalidation durable
  across process death after commit; a successful DB commit and subsequent
  cache invalidation remain separate operations.
- Public website/API/admin baseline probes, existing redirects, image/audio
  Range and CORS checks passed before any admin capacity change.

## Live verification record

Executed on 2026-10-24 after Dorad's explicit approval; #2603 merged through
the normal queue. The atomic family-save prerequisite reached production
first as admin **v0.1.137** ([CI/release](https://github.com/bible-on-site/bible-on-site/actions/runs/40125422126),
[AWS CD](https://github.com/bible-on-site/bible-on-site/actions/runs/40127358837));
the provider-only switch then replaced the sole on-demand task with one
**FARGATE_SPOT** task running exactly the verified release image:
desired/running 1, pending 0, one COMPLETED primary deployment, the old task
STOPPED. The additive provider association preserved the existing empty
shared cluster default strategy, and the private before/after comparison
found no other admin or public website/API configuration, image digest,
capacity or count change.

All eight compatibility probes passed during handover and again after the old
task stopped and discovery refreshed: website readiness/home, API health,
both admin authentication redirects, the existing legacy book redirect and
destination, and legacy S3 image/audio byte ranges with CORS. Estimated admin
compute fell from ~$11.53 to ~$3.46/month (**~$8.07/month saved**) at the
assessed rates; other AWS charges are separate. Spot interruption can still
leave admin unavailable with **no automatic on-demand fallback**; recovery
was not needed and remains the manual operator path above. The normal
release image contract (mutable latest tag) is intact — nothing was left
pinned. Full evidence, snapshots and the pinned-image recovery request stay
private per this runbook; the public record is the
[#2576 live verification comment](https://github.com/bible-on-site/bible-on-site/issues/2576#issuecomment-6388941527)
and [PR #2603](https://github.com/bible-on-site/bible-on-site/pull/2603).

## Admin revalidation follow-up - 2026-11-01

Dorad explicitly approved the configuration completion for
[#2763](https://github.com/bible-on-site/bible-on-site/issues/2763), after
the application fix in [#2857](https://github.com/bible-on-site/bible-on-site/pull/2857)
was deployed. The live admin task definition moved from revision 8 to 9,
adding the two mappings already present in `ecs-services.yaml`:

- `VITE_WEBSITE_URL=http://website.bible-on-site.local:3000`.
- `REVALIDATE_SECRET` from the existing
  `bible-on-site-revalidate-secret` SSM parameter, shared with the website.

The existing execution role already permitted the parameter read. The full
task definition was cloned; environment ordering was normalized when comparing
the AWS registration response. All other configuration, including the image,
roles, resources, network and Spot strategy, was preserved. The running image
remains admin v0.1.159, digest
`sha256:b1d17b3e4e1707d762ef2bea822d6f5b1fd8dd719fb9a00aec9814617eed0134`.

Postflight verified one COMPLETED primary deployment, desired/running 1,
pending 0, the previous task STOPPED, the expected image and FARGATE_SPOT
provider, and the new process listening. Website/API service configuration
and public health remained unchanged. An authenticated invalidation of the
existing `/pedia/משה` alias returned HTTP 200 with `revalidated: true`; the
public alias then resolved to `/pedia/משה-רבנו` and HTTP 200. The credential
was held only in memory and was not logged or stored with this record.

The full editor-save acceptance remains blocked by a separate schema gap:
the editor reports `Unknown column 'c.base_revision_id' in 'where clause'`.
The existing `tanahpedia_alter_entry_revision_history.sql` migration was
missing from the production deploy manifest. Its manifest registration is
prepared separately; no production database migration was performed during
this approved configuration rollout. The error is captured in
[the production editor screenshot](../evidence/issue-2763/editor-schema-blocker.png).
Keep #2763 open until the approved migration and a real editor publishing
check are complete.

Rollback restores task definition revision 8; a private recovery request also
pins the original image digest if the mutable release tag has advanced. This
restores the previous unconfigured revalidation behavior. Rollback was not
needed. Full task snapshots and the recovery request remain outside Git.
