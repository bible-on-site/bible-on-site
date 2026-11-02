# Website CPU capacity increase

Increase the website from **0.25 to 0.5 vCPU**, keeping **2 GiB memory, one
task and Linux/x86**. Codex owns the AWS preparation, application and verification.
Devin has no AWS access and is not assigned an open-ended investigation or
the production resize. Tracking: [#2949](https://github.com/bible-on-site/bible-on-site/issues/2949).

This is the selected mitigation after Dorad's November 2 direction. The
[November 1 RCA](../../performance/website-cpu-2026-11-01/README.md) establishes
a cached-page delivery CPU mechanism but does not account for every production
consumer. Dynamic commentary, successful server actions and all production
outliers remain incompletely attributed. Do not describe the RCA as exhaustive
or delegate those unknowns to an implementer without AWS access.

## Observed source and proposed change

Read-only preflight on November 2 verified account `250598594267`, region
`il-central-1`, cluster `bible-on-site-cluster`, service
`bible-on-site-website`, one healthy running task and no pending deployment.
The source is task definition `bible-on-site-website:16`, 256 CPU units and
2,048 MiB. Its container-level CPU setting is zero, so no separate 256-unit
container limit needs changing.

The running website 0.2.600 image and ECR `latest` both resolve to:

```text
sha256:b889b05fd075499906fc2e3dd96aafa15092dc01b8194875e34aaffad61527f5
```

An in-memory clone of the live definition, restricted to the AWS
`RegisterTaskDefinition` input fields, was validated with exactly one resource
change:

```json
{"cpu": {"before": "256", "after": "512"}}
```

Memory, container definitions, environment/secret references, execution/task
roles, volumes, networking mode, required compatibility and tags compare equal.
The proposed [reference template](../cloudformation/ecs-services.yaml) changes
only the website task's CPU field and explanatory comments. That template
has never managed the live service: **do not deploy the stack to perform this
resize**. Live application must clone the current task definition and update
the existing service after the capacity PR receives its specific AWS approval.

The CPU/memory pairing is supported by
[AWS's Fargate task-size table](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html).
The service's desired count, rolling deployment settings, health checks,
startup/drain limits, discovery, subnet/security-group configuration and
normal release behavior remain unchanged. This proposal includes no ARM
cutover, compression/cache change, new monitoring feature or disk work.

## Cost

The official Israel Linux/x86 on-demand price file, rechecked November 2,
lists $0.0518144 per vCPU-hour and $0.0056896 per GiB-hour, effective October 1.
For one continuously running task at an assumed 730 hours/month:

| Allocation | Monthly CPU and memory |
| --- | ---: |
| Current 0.25 vCPU and 2 GiB | $17.76 |
| Proposed 0.5 vCPU and 2 GiB | $27.22 |
| Increase | **$9.46** |

The increase is $0.0129536/hour, about $0.31/day. These are website task
CPU/memory estimates, not the entire AWS bill; transfer, storage, public IPv4,
tax and other resources are excluded. Brief old/new overlap during a rolling
deployment adds time-based task charges. ARM pricing/savings are separate.
[AWS regional price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/il-central-1/index.json).

## Validation and limits

The actual deployed image passed 11 isolated cases containing 2,760 page and
1,871 health requests, all 200; every page request was a prerendered cache hit.
The independent fresh broad-page runs measured page p95 of 21.6 ms at 0.5 vCPU
and 174.5 ms in the repeated 0.25-vCPU run, with health p95 17.9 and 56.5 ms.
Retain the original 0.25-vCPU 1.274-second health outlier and all warm controls.
These are local Docker quota experiments, not proof of the size of a
production improvement; Fargate uses CPU shares rather than the same Docker
quota/period control. Production follow-through must measure the result.

No AWS write, task registration, service update or production load replay
was executed during this preparation. The proposed registration payload was
validated in memory; production environment values are not copied into this
repository. Application build/tests are unnecessary for a resource-reference
and documentation change; YAML parsing, exact structural delta and normal
commit hooks validate the authored change.

## Application after specific approval

1. Recheck the account, service, source task definition, one healthy task,
   image digest and ECR `latest`; capture a private rollback journal. Abort if
   the approved source has changed, another rollout/ARM cutover is active,
   or a website publication can race the image observation. Reconcile material
   drift and approval before proceeding. Do not reuse the November 2 snapshot
   as a current-state guarantee.
2. Prepare an immutable 256-unit rollback definition and a 512-unit candidate
   from the same freshly verified source, pinning both to the captured running
   image digest. Their only resource difference must be `cpu: 256 -> 512`;
   digest pinning admits the same artifact and prevents a mutable tag from
   changing the application during the capacity comparison. Retain the original
   task definition; do not deregister it.
3. Update only the existing website service to the candidate. Keep the current
   rolling deployment and readiness/drain settings. Observe both public aliases
   continuously, requiring successful liveness/readiness/recitation and
   representative chapter/Parasha/Masora responses. Use the existing request,
   startup and deployment limits; do not add retries or extend deadlines to
   hide failure. Confirm the healthy replacement, exact digest, 512/2,048
   allocation, completed deployment, singleton task/discovery and absence of
   a surviving rollout before declaring the stage successful.
4. Restore the normal `latest` release reference in an otherwise identical
   **512-unit** definition only after `latest` freshly resolves to the same
   admitted digest. Verify the resulting task digest and public contracts
   again. If publication raced, do not admit a different image implicitly:
   retain the healthy pinned stage and resolve the release handoff explicitly.
   A permanent pin must not silently disable future normal website releases.
5. Compare pre/post origin health timings, CPU and public rolling-hour values,
   including their sampling/window limits. Record the actual deployment,
   rollback definitions, image, checks and observed effect in this report and
   #2949. A reduced capacity tail does not establish the complete RCA.

## Rollback

Any unsuccessful check or unexpected resource/image/configuration change
triggers return to the captured **256-unit immutable rollback definition**
on the same service. Verify its exact image, readiness, public aliases,
completed singleton deployment and discovery. Restore the original mutable
release definition only when its tag still resolves to the admitted fallback
artifact. Keep both immutable definitions and the original definition until
postflight completes; do not roll back to an unverified current `latest`.

Registering or switching these definitions is live AWS work. The request to
increase capacity selects the change, but repository policy still requires
Dorad's approval of the specific capacity PR before merge or application.
Approval of documentation PR #2950 did not approve this operational change.
