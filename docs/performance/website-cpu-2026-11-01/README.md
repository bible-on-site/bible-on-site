# Website CPU investigation on November 1 2026

The website's response-time increase includes genuine application delays.
The deployed website image reproduces a 1.274-second unrelated health-check
stall while serving **prerendered cache hits** at its production allocation
of 0.25 vCPU and 2 GiB. Repeated delivery work, first-use page-cache work and
CPU throttling deserve attention before treating a capacity increase as the
only solution. Calendar PDF rendering has already moved off this request path.

Implementation is queued for Devin in
[#2949](https://github.com/bible-on-site/bible-on-site/issues/2949), on the
website project with the `Devin Backlog` label. This report is investigation
evidence; that task owns the implementation and its separately approved rollout.

## Production observations

Read-only inspection targeted account `250598594267`, region `il-central-1`,
cluster `bible-on-site-cluster`, service `bible-on-site-website`.
The service had one healthy running task, task definition `:16`, 256 CPU
units, 2,048 MiB and ECS Exec disabled. No production configuration, content,
traffic control or capacity was changed. Disk remediation is assigned to Dorad
separately and is excluded from this investigation.

At 13:24 UTC (15:24 Jerusalem), the four explicit rolling-hour snapshots were:

| Monitor | Mean time to first byte | Samples |
| --- | ---: | ---: |
| Website `.co.il` | 744.944 ms | 54 |
| Website `.com` | 666.056 ms | 54 |
| API `.co.il` | 450.746 ms | 59 |
| API `.com` | 446.345 ms | 55 |

These monitors hit the website's `/api/health` and the separate API's `/health`.
They do not measure a complete browser page load. The website snapshots use
the existing bounded endpoint in
[`response-time.ts`](../../../web/bible-on-site/src/lib/response-time.ts).
The comparable API values are useful controls for shared public routing;
they do not identify each network phase of a website request.

Existing nginx probe logs place the added delay upstream, inside the website
path. In the 11:00-12:00 UTC hour, 181 website health requests averaged 72.1 ms
upstream, with p95 279 ms. In 12:00-13:00 UTC, 179 requests averaged 228.4 ms,
with p95 1,474 ms and maximum 9,923 ms. Average proxy request times were 72.4
and 228.7 ms respectively. Later slow health records through 16:21 UTC still
showed 1.0-2.8-second upstream delays with 0-1 ms upstream connections.
These timing records include successful checks and are not solely an outage
or network-distance effect.

CloudWatch's six-hour sample through approximately 16:32 UTC contains 353
one-minute website CPU periods. The mean of their averages is 27.98% of the
allocation; 57 periods contain a reported sample at or above 90%, including
18 at or above 99%. These are aggregate utilization samples, not direct
production measurements of per-request throttling. The earlier router
24-hour window averaged 0.81% CPU, with minimum CPU credit balance 576.

## Work arriving at the website

The five-hour nginx aggregation ending 16:32 UTC contains 88,109 requests
across all logged virtual hosts and schemes, including rejected traffic.
Of those, 63,482 (72.0%) have the Next.js `_rsc` query marker. The largest
families are `/929` (33,856), `/פרשה` (17,890), `/מסורה` (15,452), and `/`
(12,135). A later hour includes commentary selectors such as `perush` and
`haftaraPerush`, plus successful and failed server-action POSTs.

A query marker does not prove that the client sent the `RSC` header or
identify a request as a genuine browser navigation. Both recognized crawlers
and browser-like declared user agents appear. A few anonymous client groups
make hundreds of page requests without static-resource requests, but that
alone does not establish bot identity or justify blocking them. The combined
log lacks general request duration, response encoding and host, so page-family
counts cannot be converted into CPU attribution or per-domain percentiles.

There were **zero `/api/calendar-pdf` requests** in this five-hour window.
The current route resolves pre-generated artifacts without inline rendering;
that implementation was delivered by
[#2702](https://github.com/bible-on-site/bible-on-site/pull/2702), addressing
[#2608](https://github.com/bible-on-site/bible-on-site/issues/2608).
The current latency should not be assigned to the older PDF reproduction in
[#2509](https://github.com/bible-on-site/bible-on-site/issues/2509).

Only 340 requests in this window target `/_next/image`; image optimization
is not assumed to be the cause merely because it can consume CPU. The
current website log stream contained 34 missing-action and six invalid-action
errors among 159 log events. That sample is not a count of all POST requests
and does not prove those failures dominate CPU.

## Isolation and measured CPU work

The local test uses the actual running **website 0.2.600** image, not a new
development build:

```text
250598594267.dkr.ecr.il-central-1.amazonaws.com/bible-on-site@sha256:b889b05fd075499906fc2e3dd96aafa15092dc01b8194875e34aaffad61527f5
```

Production task `7230a45a6d1542498a48f0b9c3d6cd90` started at 13:25:46 UTC
with that digest. Repository HEAD at investigation setup was `cc4bd1548`
(the later 0.2.601 version commit). The runtime reports Next.js 16.4.3.

Containers run locally on Docker Desktop/Linux amd64 with 2 GiB memory,
256 or 512 CPU units equivalent, and no production credentials or database
access. Node's inspector samples the main thread. Linux cgroup v1 counters
and per-thread CPU ticks provide separate total-CPU and throttling evidence.
The default image health command is disabled in the experiment; the harness
sends its own independent liveness checks. No workload is replayed against
production.

All measured page requests return **200 and `x-nextjs-cache: HIT`**. This
reproduces delay without database queries, PDF generation, image optimization,
fresh SSR rendering, or invalid requests. It does not exclude additional
contributors on production's dynamic paths.

The main-thread samples identify:

- Next.js page-response ETag hashing: the compiled response-sending code
  walks the complete unchunked response string with `charCodeAt` before
  setting `ETag` and checking freshness.
- Next.js filesystem page-cache reads and `promoteSeed`, including response
  metadata parsing and first-use promotion into the mutable route cache.
- Routing, response streaming and garbage collection. A cache hit still
  performs this delivery work.

In the first broad gzip run, the sampled thread CPU counters increased by
499 ticks on the main thread, 311 across libuv workers, and 129 across V8
workers. In the corresponding fresh identity-encoding run, those increases
were 402, 64 and 120 ticks. The change in libuv work, together with the CPU
and encoding control below, establishes a material compression contribution;
libuv also performs filesystem work, so its entire CPU is not labeled gzip.
Main-thread sample percentages are wall-time samples and must not be
presented as percentages of total container CPU.

## Workload and controls

The broad workload schedules 360 page requests at five starts per second,
with gzip accepted and an independent health request approximately every
500 ms. For zero-based index `i` from 0 through 359, choose:

```text
i % 3 == 0: /929/{1 + (i * 17) % 929}
i % 3 == 1: /מסורה/{1 + (i * 19) % 2874}
i % 3 == 2: /פרשה/{parashaDivision.units[i % 54].slug}
```

The 54 slugs use the order in
[`parasha-division.json`](../../../web/bible-on-site/src/data/parasha/parasha-division.json).
Before profiling, fetch these eight fixtures once: `/`, `/929/1`, `/929/686`,
`/מסורה/1`, `/מסורה/2874`, `/פרשה/בראשית`, `/פרשה/דברים`, `/פרשה/כי-תצא`.
Their uncompressed HTML bodies range from 57,684 to 799,640 bytes.
"Fresh" below means a fresh container with only those fixtures warmed;
the host filesystem cache is not cleared. Subsequent passes in a container
use the same ordered requests. RSC-header checks on the eight repeated
fixtures were also 200/HIT and were faster than the first broad HTML pass.

| Case | vCPU | Page p95 | Health p95 | Health maximum | Total CPU time | Throttled periods |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fresh broad pages, gzip | 0.25 | 558.9 ms | 96.5 ms | 1,274 ms | 11.730 s | 222 / 730 |
| Same pages after first pass, gzip | 0.5 | 17.4 ms | 7.2 ms | 74 ms | 6.656 s | 4 / 723 |
| Same pages again, gzip | 0.25 | 22.7 ms | 8.5 ms | 163 ms | 7.418 s | 34 / 726 |
| Fresh broad pages, identity encoding | 0.25 | 81.7 ms | 11.1 ms | 349 ms | 7.959 s | 62 / 728 |
| Independent fresh broad pages, gzip | 0.5 | 21.6 ms | 17.9 ms | 103 ms | 9.874 s | 32 / 726 |
| Independent fresh gzip repeat | 0.25 | 174.5 ms | 56.5 ms | 193 ms | 9.386 s | 85 / 726 |

The identity control skips app-side gzip; it is **not** a proposed
uncompressed public delivery policy. Total CPU is 15.2-32.2% lower than the two
fresh 0.25-vCPU gzip runs. The runs share a local host and are not randomized repeated
benchmarks, so that difference is evidence for a candidate, not a guaranteed
production saving. The return to a fast 0.25-vCPU pass also shows that comparing
only the first row with the warm 0.5-vCPU row overstates the benefit of resizing.
The independent fresh 0.5-vCPU run improves both page and health p95 compared
with the repeated fresh 0.25-vCPU run, with similar total CPU work. The initial
1.274-second health maximum did not repeat at the same magnitude; retain it
as observed evidence rather than claiming every fresh run stalls that long.

The cold-cache slowdown is real despite every response reporting HIT.
Repeated requests can hide it. Existing startup checks warm health,
readiness and recitation routes; they do not warm the thousands of page
cache entries exercised by crawlers and reader navigation.

## Implementation decision

The implementation task should first remove or relocate avoidable request
work. Evaluate compression on the existing proxy or bounded precompression,
and reduce measured first-use page-cache/payload work where the profile
supports it. Preserve compressed delivery of HTML **and** `text/x-component`,
cache variation, conditional GET/HEAD, ranges, RSC navigation and invalidation.
Next.js explicitly supports handing compression to a separately configured
server: [compression configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/compress).
An nginx-only `gzip on` does not establish that RSC content types are covered.
Account for additional origin-to-router bytes and possible cross-zone costs
before selecting compression offload.

Do not cache or bypass the health route to improve its badge, disable
validators without compatibility evidence, block navigation query parameters,
introduce an unreviewed CDN cache, or extend deadlines and retries. The task
must retain the first slow pass as a regression case and measure real
dynamic commentary/server-action paths separately against an isolated local
database. Production-wide CPU attribution still needs those paths; this
experiment establishes a sufficient cached-page delivery mechanism.

If the best safe implementation still misses the retained latency target,
prepare a **0.5-vCPU / 2-GiB** website alternative with an equivalent fresh
container comparison, immutable image identity and rollback. The one-minute
service average understates brief throttled bursts; see
[AWS task sizing guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-tasksize.html).

The official Israel Linux/x86 on-demand price file effective October 1 lists
vCPU at $0.0518144/hour and memory at $0.0056896/GiB-hour. At an assumed
730 hours/month, unchanged memory and one task, moving 0.25 to 0.5 vCPU changes
CPU/memory charges from approximately **$17.76 to $27.22/month**, an increase
of **$9.46/month**. This excludes transfer, storage, tax and other resources;
ARM migration and its separate savings are not included.
[AWS regional price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/il-central-1/index.json).

Any implementation affecting nginx, deployment or resource allocation must
be pushed and validated, then receive Dorad's approval of that specific PR
and its current AWS impact before merge or live application. Preserve the
current task definition and immutable image as rollback. The documentation
change itself alters no runtime or AWS resource.
