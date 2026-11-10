# Website handover latency: measured drain and earlier health

Issue [#2997](https://github.com/bible-on-site/bible-on-site/issues/2997)
tracks restoring the 300-second protected handover window. This document
records the latency changes and how to read their evidence. The original
90-second listener drain and its rationale are described in
[deployment-readiness-2026-10-06](deployment-readiness-2026-10-06.md); the
measured replacement below keeps its protections.

## Measured connection drain

`web/bible-on-site/scripts/start-server.mjs` previously held the old listener
for an unconditional 90 seconds after SIGTERM. The observed old-task
STOPPING→stopped path took ~114 seconds, most of it that fixed wait.

The router proxies each request on a fresh upstream connection (variable
`proxy_pass`, no `upstream` keepalive), so the task's own socket table answers
the question the fixed wait was guessing at: *is any cached-DNS client still
being served?* The launcher now polls `/proc/net/tcp` (and `tcp6`) every
500 ms and counts sockets whose local port is the server port, whose state can
still carry request or response bytes (`ESTABLISHED`, `SYN_RECV`,
`CLOSE_WAIT`), and whose remote address is not loopback. Loopback remotes are
same-host clients — the container's own health-check curls and exec sessions —
which need no DNS protection and cannot outlive the task.

SIGTERM still ends the drain once inbound connections have been quiet for 30
seconds and never past the same 90-second deadline as before. The floor under
that is now measured instead of guessed: the task resolves its own discovery
name (`website.bible-on-site.local`, overridable via `WEBSITE_DISCOVERY_NAME`)
through the same VPC resolver the router uses, every drain poll:

- While a readable answer still lists this task's address the floor stays
  open — quiet clients can still be routed to an advertised address.
- Once answers provably stop naming the task, the floor clears one full
  router-cache window (`valid=10s`) after the last moment the address could
  still have been listed — the last "listed" read, or the first "absent" read
  when removal already propagated before SIGTERM. A cached answer naming the
  removed address can be at most that old, so quiet termination after the
  window cannot drop cache-held traffic.
- If no discovery read ever succeeds, the previous 45-second fixed minimum
  still applies — a zero socket count cannot prove removal, and a missing
  answer cannot either. Removal propagation that outlasts the old estimate
  now extends the drain toward the 90-second cap instead of exposing the
  still-advertised address early.
- A client still arriving at the removed address refreshes the activity
  timestamp, stretching the drain toward the cap exactly as before.
- An unreadable socket table (non-Linux, restricted procfs) is treated as
  busy, so the drain falls back to the original 90-second deadline instead of
  exiting early or hanging. The 90-second bound still holds in every case.
- SIGINT and a second SIGTERM keep their existing semantics, child exit codes
  are preserved, and the 120-second `StopTimeout` still leaves ~30 seconds
  for the Next graceful shutdown after the forward.

The first read that finds the address gone logs
`Website task left discovery answers after <elapsed>ms`, recording the
actual Cloud Map removal propagation for the deployment instead of assuming
the ~35-second estimate.

`drainMs`, `minDrainMs`, `quietMs`, `pollMs`, `routerCacheMs`,
`dnsTimeoutMs`, the port, the metric reader, the resolver, the discovery
name, the own-address provider and the loggers are injectable for tests;
production uses `PORT` (default 3000), procfs and the VPC resolver with a
one-second query timeout (cancelled with the child).

## Early readiness probe

The readiness warm-up (canonical data, search indexes, recitation package,
page renderers, database and sanitizer checks inside `GET
/api/health/ready`) is the dominant controllable startup cost — measured at
~2.0–2.8 s of CPU on a developer machine for the data stages alone
(`sefarim` Brotli+JSON load ~0.60 s, `getPasukIndex` ~0.73 s,
`recitationResponse` ~0.65–1.36 s producing the ~8 MB package, DOMPurify
~0.01 s), before page renders and database work. On the 0.5 vCPU task this
is the bulk of the observed ~44 s cold-admission delta.

Before this change the warm-up could not start until the first scheduled
container check: Docker's `--start-interval=5s` fires the first probe
seconds after the listener is already queueing requests, so the warm-up
waited on a schedule instead of the socket. `start-server.mjs` now fires
the same `GET /api/health/ready` as soon as `127.0.0.1:<port>` accepts a
connection, retrying refused connections every 250 ms. The endpoint is
authoritative and shares one in-flight check between concurrent callers —
canonical data, indexes, recitation package, sanitizer, content query and
page renders all run once — so the probe is only an early client of the
warm the health check already drives; sequential checks still re-verify
the database. Any HTTP response ends the probe, and `stop()` on child exit
aborts a pending request so the wrapper never outlives its child (retry
timers are unref'd for the same reason). The probe is best-effort: each
distinct transport failure warns once as
`Website readiness probe attempt failed: …`, probe defects never change
the launcher exit status, and the container `HEALTHCHECK` stays
authoritative. The probe logs two boundaries:

- `Website listener accepting connections after <elapsed>ms` — one bare TCP
  handshake marks the first listening socket, separating process start from
  the initialization work before accept.
- `Website readiness probe: HTTP <status> after <elapsed>ms` — the first
  queued readiness response; the gap between the two lines is the
  initialization and warm-up work itself.

Inside `/api/health/ready` the public-content query now fires before the
synchronous warm-up runs, so its pool setup and round trip overlap the data
load, and the page-render warm is awaited together with the query instead of
behind it — all gates are unchanged, the same check still runs once per
admission and the database is still re-verified on every sequential probe.

## Lifecycle timing evidence

The launcher logs the boundaries that were previously invisible:

- `Website listener accepting connections after <elapsed>ms` — first
  listening socket.
- `Website readiness probe: HTTP <status> after <elapsed>ms` — the early
  warm-up probe's first response; with container start and ECS health events
  it separates launcher start, listener readiness and warm completion.
- `Website draining cached DNS requests: forwarding SIGTERM after <quiet>ms
  without inbound connections, once this task has been out of discovery
  answers for <router cache>ms (<min>ms when discovery is unreadable), or
  <drain>ms at most` — drain began.
- `Website task left discovery answers after <elapsed>ms` — the first read
  that found this task's address gone: the actual Cloud Map removal
  propagation for that deployment.
- `Website drain <reason> after <elapsed>ms; forwarding SIGTERM to server.js` —
  drain ended (`saw no inbound connections` or `reached the deadline`).

Together with container start, ECS health and Cloud Map events these lines
separate SIGTERM receipt, measured drain, forwarded shutdown and exit in
CloudWatch — the per-phase split the issue asks for. Server-side stall detail
during the same window comes from the opt-in event-loop diagnostics delivered
under [#2991](https://github.com/bible-on-site/bible-on-site/issues/2991)
(`ENABLE_EVENT_LOOP_DIAGNOSTICS`, UTC-aligned JSON lines), which
correlates with these boundaries by timestamp.

## Earlier container health

The website container health check already doubles as the route-bundle warm
(readiness, recitation catalog, `api/recitation/2`). Its first run happened one full
30-second interval after container start, making interval itself the
time-to-healthy bound. The interval is now 10 seconds (5-second start interval
in the Dockerfile check), keeping timeout 10s, retries 5 and start period
120s. A first success during the start period still marks the task healthy;
the earlier probes simply warm and accept sooner, then Cloud Map registration
begins earlier. Steady-state cost is three bounded curls every ten seconds —
negligible at 0.5 vCPU.

`docs/aws/cloudformation/ecs-services.yaml` is reference documentation only;
the live task definition change is applied by cloning the current revision as
described in the readiness document, and requires Dorad's approval of the
specific PR under the root `AGENTS.md` AWS rule.

## Deliberately unchanged

- Cloud Map A-record TTL (10s) and `HealthCheckCustomConfig` failure threshold
  (1) are already minimal; the ~30-second ECS-healthy→Cloud-Map-healthy gap is
  AWS-internal health propagation, not a tunable on our side. Confirmed
  against AWS documentation: `FailureThreshold` multiplies a fixed
  30-second interval before Cloud Map acts on an ECS health change
  ([HealthCheckCustomConfig](https://docs.aws.amazon.com/cloud-map/latest/api/API_HealthCheckCustomConfig.html),
  [aws/containers-roadmap#449](https://github.com/aws/containers-roadmap/issues/449)
  — the interval itself is not configurable).
- `MinimumHealthyPercent: 100` / `MaximumPercent: 200`, desired count,
  capacity, `StopTimeout: 120`, the deployment circuit breaker setting and all
  routing/protection behavior are unchanged.
- No timeouts, retries or polling budgets were increased; the drain cap is
  identical, the health-check budget is unchanged, and the 45-second minimum
  still applies whenever discovery cannot be read. Every readiness gate —
  canonical data, search indexes, recitation package, sanitizer, public
  content query and page renders — is still checked before admission.
