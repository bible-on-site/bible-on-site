# Website readiness during an ECS handover

Issue [#2016](https://github.com/bible-on-site/bible-on-site/issues/2016)
tracks public request stalls during normal website rollouts. Final CD success
proves that the release eventually serves; it does not prove uninterrupted
availability during the handover.

## Captured failure

Normal website 0.2.470 CD run 37531275073 reproduced the earlier 0.2.469
handover stalls on 2026-10-06. At 21:13:05-21:14:50 UTC, cancelled readiness
and recitation requests all selected the **new** task
`3f3c155c6d384c3db8a40278d1658bff`, at `172.31.26.62:3000`. Connection time
was 0.000-0.003 seconds, but no upstream headers arrived before the client
timed out. Service CPU reached approximately 100%. Responses recovered
around 21:15:18. The old task began stopping at 21:12:45.441.

Task definition revision 13 checked `/api/health`, which can succeed before
the canonical-data routes load. The observed failure was delayed application
response after a successful connection, not a stale upstream address. The
separate Nginx temporary-directory validation incident was already corrected
before this normal rollout.

The next normal 0.2.472 rollout captured both phases. At 21:45:31-21:45:38,
eight router probes returned 502 while selecting the old address
`172.31.26.62:3000`; the old task began stopping at 21:45:18.287. Requests then
connected promptly to the new address `172.31.32.179:3000` but waited without
headers during cold loading. A three-minute public sample contained 31 failed
requests out of 135. Readiness alone addresses the second phase; the old
listener must also remain available while discovery and cached DNS change.

## Reproduction and repair

The exact published 0.2.470 image was tested locally with the deployed
0.25 CPU / 2048 MB limits. Its configuration digest
`sha256:9c323b6a5553cb47e7eac40643cf5ac983d2f116adcde6eaf4f4220398a758e8`
matches the configuration in the deployed ECR manifest
`sha256:2b77782737e53ed2acf691ac60982a9e80339d3cdfbf27d2f0ae6b4d06849e2d`.

After liveness returned 200, the first `/api/recitation` request took
18.179 seconds and concurrent five-second health probes timed out. A repeated
request took 1.301 seconds. Loading its canonical-data route blocked the
server after it could already pass the deployed liveness check.

With `/api/health/ready` as the container health check, the same cold image
remained in `starting` while loading its data. It became healthy on the
second check. The first recitation request then took 1.723 seconds, concurrent
health requests completed in 0.011 seconds, and subsequent readiness and
chapter probes succeeded. Both experiments returned the same complete
884,490-byte recitation body with SHA-256
`4279d6bb8ae2e670daa886f1a7957e22550656afd0290ba003e6827445065af4`.

The repair uses the existing readiness endpoint in both the website
Dockerfile and the documented ECS task definition. A small production launcher
retains the old Next listener for 90 seconds after SIGTERM, then forwards that
signal to Next for its normal shutdown. Duplicate SIGTERM does not extend the
deadline; SIGINT remains immediate, and child failures retain their exit code.
The ECS stop timeout is 120 seconds, allowing a further 30 seconds for Next
to finish in-flight requests. Local development commands keep their existing
launcher. Capacity, health-check timings, routing, and canonical data are
preserved. The packaged-image check waits for Docker readiness at the production limits
before verifying every approved chapter and the complete app extension.
Failure or a five-minute startup timeout prevents publication of that image.

The real Linux child-process tests passed all four signal/failure cases. The
published image with the production launcher, at the same CPU/memory limits,
also served 61 requests with zero failures during its full 90-second drain.
The complete recitation body retained the same hash; the longest request took
1.760 seconds. A second SIGTERM did not reset the deadline, and the container
exited normally with code 143 after 90.814 seconds.

AWS counts the replacement's essential container health check before retiring
the old task under `MinimumHealthyPercent: 100`; an early successful check
during `StartPeriod` already makes a container healthy. A longer start period
alone therefore does not fix premature acceptance. See the
[ECS health-check rules](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html)
and [service deployment rules](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html).

The drain covers Route 53's usual propagation window of up to 60 seconds plus
the router's ten-second DNS cache, with a margin. It is bounded rather than a
guarantee about every possible DNS failure. See the
[Route 53 change rules](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html)
and [Fargate stop-timeout rules](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html).

## Applying and validating the live change

The CloudFormation templates are reference documentation and have never been
deployed. Do not deploy the entire template to apply this change. After the
source passes normal CI and merge, clone the service's **current** task
definition and change its website health-check URL to
`http://localhost:3000/api/health/ready` and its `stopTimeout` to 120.
Keep all other fields and secret
references intact. Recheck that no rollout or other task-definition update
has started before updating the service to the new revision.

The stop timeout applies to newly started tasks. An already-running image with
the old launcher cannot acquire the new listener drain retroactively. For the
first transition, temporarily protect that old task from deployment termination.
After the replacement passes readiness and complete response checks, save the
old Cloud Map instance attributes and deregister that old instance. Keep its
protected listener alive until discovery removal and the 90-second DNS drain
complete; then remove protection promptly. Restore the saved discovery instance
if the replacement fails before handover. Use a bounded protection expiry and
verify cleanup; do not leave protection enabled for later deployments. See the
[ECS task-protection rules](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-scale-in-protection.html).

Observe a complete rollout using the router probe log, public health,
readiness, and recitation requests, ECS task health, and Cloud Map health.
Verify the running image against its release provenance and compare complete
response bodies. Validate a subsequent ordinary rollout without temporary task
protection or manual discovery changes to prove the steady-state handover.
The readiness endpoint initializes canonical server data;
it does not promise that every database-backed page or every future failure
mode is ready. Keep #2016 open until the live handover has been validated.
