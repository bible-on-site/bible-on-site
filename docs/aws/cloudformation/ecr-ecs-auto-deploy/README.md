# ECR to ECS rollout state

The Python file and template in this directory are **undeployed scale-up
proposals**, not snapshots of the running Lambda. Running task counts do not
prove readiness, Cloud Map propagation, or uninterrupted public availability.
Do not deploy these proposals as a fix for a handover failure.

Read-only AWS inspection on 2026-10-06 verified that `ecr-to-ecs-deploy` only
calls `UpdateService(forceNewDeployment=True)` for the website, API, or admin
service. Its handler is `ecs-deploy-lambda.handler`, runtime is Python 3.12,
timeout is 30 seconds, and its last modification is 2026-02-25. The retrieved
code archive has SHA-256 (base64) `+LA84RQhCaaH3SXfFure7h7wVcGBh8dXO+gcRb8qi5k=`.
The [parent template](../ecr-ecs-auto-deploy.yaml) contains the same force-only
logic; its inline-code handler is `index.handler` because CloudFormation names
inline Python modules `index`.

Website 0.2.469 passed final CD and public health, warmed readiness, and
recitation verification. During its handover, the existing router log also
recorded cancelled health requests from both probes and the uptime monitor.
The exact stalled backend and timing were absent from that log. This is tracked
in [#2016](https://github.com/bible-on-site/bible-on-site/issues/2016).

The router configuration adds a separate `release-probes.log` for health,
readiness, and recitation paths. It records status, response version, upstream
address, and connection/header/response/request durations. It excludes client
addresses, query strings, cookies, and other request headers, and preserves the
existing access log. Routing, timeouts, retries, capacity, and the Lambda stay
unchanged.

Capture the original failed probe during the next normal rollout, correlate its
upstream with ECS health and Cloud Map state, and validate the corresponding
repair through normal delivery. Final CD success alone does not prove that all
requests succeeded throughout the handover.
