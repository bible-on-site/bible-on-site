# Website handover latency: measured drain and earlier health

Issue [#2997](https://github.com/bible-on-site/bible-on-site/issues/2997)
tracks restoring the 300-second protected handover window. This document
records the two latency changes and how to read their evidence. The original
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

SIGTERM now ends the drain as soon as inbound connections have been quiet for
30 seconds, capped by the same 90-second deadline as before:

- A client still arriving at the removed address refreshes the activity
  timestamp, so slow Cloud Map removal propagation stretches the drain toward
  the cap exactly like the old fixed wait — up to and including pathological
  cases. Nothing that was served before is refused earlier.
- A connection arriving after the quiet decision is refused only in the
  sub-second window before the listener closes — the same exposure the fixed
  deadline had at its own edge.
- An unreadable socket table (non-Linux, restricted procfs) is treated as
  busy, so the drain falls back to the original 90-second deadline instead of
  exiting early or hanging. The 90-second bound still holds in every case.
- SIGINT and a second SIGTERM keep their existing semantics, child exit codes
  are preserved, and the 120-second `StopTimeout` still leaves ~30 seconds
  for the Next graceful shutdown after the forward.

`drainMs`, `quietMs`, `pollMs`, the port, the metric reader and the logger are
injectable for tests; production uses `PORT` (default 3000) and procfs.

## Lifecycle timing evidence

The launcher logs the two boundaries that were previously invisible:

- `Website draining cached DNS requests: forwarding SIGTERM after <quiet>ms
  without inbound connections, or <drain>ms at most` — drain began.
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
(readiness, recitation catalog, chapter 2). Its first run happened one full
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
  AWS-internal health propagation, not a tunable on our side.
- `MinimumHealthyPercent: 100` / `MaximumPercent: 200`, desired count,
  capacity, `StopTimeout: 120`, the deployment circuit breaker setting and all
  routing/protection behavior are unchanged.
- No timeouts, retries or polling budgets were increased; the drain cap is
  identical and the health-check budget is unchanged.
