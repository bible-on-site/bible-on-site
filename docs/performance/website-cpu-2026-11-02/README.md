# Website CPU: completed research and capacity decision

The observed latency regression is caused by **bursty page delivery competing
for the website's 0.25 vCPU**, including work on prerendered cache hits. The
selected remedy is **0.5 vCPU, retaining 2048 MiB and one task**. Codex owns
the AWS change and verification in [#2949](https://github.com/bible-on-site/bible-on-site/issues/2949).

This decision follows successful database-backed action tests, CPU profiles,
controlled alternatives, and a paired experiment on actual AWS Fargate.
Devin receives a separately reproduced search-normalization fix; further AWS
research and the capacity rollout are not delegated.

## Evidence and scope

The investigation targeted account `250598594267`, region `il-central-1`,
cluster `bible-on-site-cluster`, service `bible-on-site-website`. The production
baseline was task definition 16, website 0.2.600, Next.js 16.4.3, x86, CPU 256,
memory 2048, desired count one. The tested immutable image is:

```text
250598594267.dkr.ecr.il-central-1.amazonaws.com/bible-on-site@sha256:b889b05fd075499906fc2e3dd96aafa15092dc01b8194875e34aaffad61527f5
```

The [November 1 report](../website-cpu-2026-11-01/README.md) records the initial
cached-page experiment. This report supplies the broader research and final
decision. Sanitized results are in [measurements.json](measurements.json),
and public replay paths are in [replay-fixture.json](replay-fixture.json).
Client addresses, credentials, request bodies, search phrases from logs,
database dumps and content are excluded from these artifacts.

### Production observations

The aligned CloudWatch window contains 980 one-minute samples from November 1
13:30 UTC. Website mean CPU utilization was 28.50% of its allocation, but
60 minutes contained a maximum sample at or above 99%. The corresponding
website health records have median upstream time **6 ms**, p95 **1300 ms**,
p99 **3233 ms**, and maximum **13463 ms**. There were 186 checks above one
second. A low minute average does not exclude a short queue at the CPU limit.

The nginx aggregation contains 271323 requests across its logged hosts and
schemes, including redirects and rejections. Approximately 95000 are article
or commentary detail GETs, and 23000 are successful or attempted reading-page
POSTs. In the worst minute, November 1 21:50 UTC, Masora had 1001 requests;
966 came from one anonymous client declaring a mobile browser, 692 ended as
499, and 292 as redirects. Those requests had no `_rsc` query marker.
Website average CPU was 99.6%, while health checks took 7.7-13.5 seconds.
This is evidence of a costly burst, not a verified bot identity or permission
to block a class of readers.

The proxy averaged 0.91% CPU, peaked at 5.83%, and retained 576 CPU credits.
RDS averaged 4.32% CPU, peaked at 18.85%, and averaged 13.47 connections.
Read/write latency remained in the low milliseconds. Website memory utilization
was 36.70-65.18%, consistent with a growing working set rather than a memory
limit failure. A separate 90-sample live process observation showed heap
430-519 MiB, with brief stalls and heap drops. That observation cannot itself
measure production garbage collection. Disk work belongs to Dorad's separate
task and was left alone.

The combined access log lacks host, general request duration and request
headers. Counts cannot establish per-route CPU shares, `_rsc` does not prove
an RSC header, and declared user agents do not establish client identity.
The CPU attribution below comes from controlled replays and profiles.

## Every relevant CPU path checked

| Consumer or hypothesis | Investigation and finding |
| --- | --- |
| Cached HTML and RSC delivery | Replayed real detail URLs, Masora, Parasha, homepage and selectors. Routing, response metadata parsing, first-use seed promotion, response hashing, compression and GC remain on the delivery path even for HITs. Native Fargate reproduces sibling health stalls. |
| Fresh SSR and database-backed pages | Used a fresh canonical `sync-from-prod` copy: 339715 notes, 2681 articles, 68 authors, checkpoint for 118 tables. Mixed native replay included 350 HIT/10 MISS responses; every page passed at both CPU sizes. No production write endpoint was replayed. |
| Successful server actions | All 140 requests passed across summaries, article content, dedication lines and commentary actions. At two starts/second, health p95 was 34.6 ms and maximum 881 ms. This exceeds the observed average POST rate without reproducing the page-delivery saturation. |
| Largest legitimate book batches | Tested 149 chapter IDs and 428 Masora units, matching the largest UI book scopes. All four actions passed; action p95 1805 ms, health p95 18.1 ms, maximum 653 ms. Database waiting is visible without making it the general health-stall explanation. |
| Search | Found and counterfactually fixed quadratic text normalization on the shared event loop. The exact defect, equivalent transformation and results are below. Zero `/api/search` requests were observed in this production window, so this defect is not substituted for the current badge's traffic cause. |
| Garbage collection and lazy initialization | Collected Node GC events, heap statistics, thread counters and main-thread profiles. Burst allocation and lazy route-module imports can delay siblings. Native GC wall duration fell with more CPU; it is not an independent additive CPU percentage. The cold non-search API mix also exposed first-use module stalls; warmed controls retain that distinction. |
| Image optimization | Replayed 64 observed optimizer URLs successfully at 0.25 CPU: 1.712 CPU-seconds total, health p95 47.5 ms, maximum 202 ms. There were 871 optimizer requests in the longer production window. It is not a dominant recurring consumer at that volume. |
| Recitation, verse previews and sitemap | Tested the real endpoints separately from search, including cold and warmed route bundles. Catalog serialization/ETag is already cached once per configuration; sitemap is statically generated. First-use imports can stall the thread, so cold results are retained, not silently discarded. |
| Invalid actions and missing routes | Replayed separately with their actual rejection/not-found status retained in the results. Production missing/invalid-action error logs are not treated as a count of all POSTs. No evidence makes these errors the normal workload's main consumer. |
| Calendar and book PDF work | The calendar route resolves pregenerated files; there were zero calendar-PDF calls in the production window. Book rendering is delegated to the bulletin Lambda; website work prepares/serializes content. Of 23768 POST responses, none exceeded 1 MiB; p99 was 70955 bytes. The older inline-calendar failure is not assigned to this regression. |
| Other APIs, timers and revalidation | Inspected search bounds, API caching, auth/mutation paths and download registrations. The log has one successful revalidation, very few store/monitor API calls, and no recurring CPU job sufficient to explain the observed sustained bursts. Mutation/delivery endpoints were inspected without notifying users or changing production content. |
| Proxy, RDS, CPU credits and network | Proxy/RDS metrics and nginx upstream timings exclude those machines' sustained CPU exhaustion. Sub-millisecond upstream connections alongside multi-second responses place the extra delay at the website. Public monitor timings still include network/TLS overhead. |

## Native Fargate comparison

Two standalone diagnostic tasks used the exact immutable x86 image, 2048 MiB,
the existing private network access and 256/512 CPU. They were not ECS service
members, had no discovery registration and received no public traffic. A small
identical private diagnostic proxy collected process CPU/GC statistics while
forwarding requests to the unmodified application. Only read paths and the
recorded page workload were replayed. Both tasks were stopped, and their
temporary task definitions were deregistered.

Startup readiness, recitation and one fallback page were warmed consistently.
The ordinary case is the deterministic 360-path fixture at five starts/second.
The burst case retains all 796 accepted/aborted page requests from the recorded
minute, scheduled by its second offsets. Source 499s are completed in the replay,
so this conservatively retains their offered work. RSC headers are inferred only
for marked URLs because the original headers were not logged.

| Native case | vCPU | Page p95 | Health p95 | Health maximum | Process CPU time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary mix, 360/360 page responses 200 | 0.25 | 4796.2 ms | 1298.0 ms | 2003.3 ms | 14.079 s |
| Same ordinary mix, 360/360 page responses 200 | 0.5 | 685.0 ms | 116.5 ms | 726.4 ms | 13.704 s |
| Full burst, 796/796 page responses 200 | 0.25 | 14795.8 ms | 10004.9 ms | 10004.9 ms | 15.757 s |
| Same full burst, 796/796 page responses 200 | 0.5 | 3825.4 ms | 2413.1 ms | 3924.9 ms | 16.131 s |

The quarter-CPU burst includes timed-out health probes; their ten-second
deadline was retained and they remain failures in the JSON. Resizing helps
substantially but does not make the extreme burst healthy. This is one paired
trial on different Fargate hosts, not a service-level guarantee.

Docker controls were useful for CPU profiles and changes to the same artifact.
Their CFS quota counters are not production throttling measurements: AWS states
that [Fargate uses CPU shares](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html).
The native tests also exposed a different V8 heap limit from Docker despite
the same task memory. Absolute Docker latency and GC timings are therefore not
presented as native AWS measurements.

## Alternatives measured before selecting capacity

All local ordinary controls used the same 360 requests, fresh container,
database, warmed canonical/fallback data and five starts/second. Every response
was 200, with 350 HITs and ten MISSes. Only the stated setting changed.

| Local control at 0.25 vCPU | Total CPU | Page p95 | Health p95 |
| --- | ---: | ---: | ---: |
| Current configuration | 11.301 s | 1299.4 ms | 186.3 ms |
| ETag generation disabled, experiment only | 10.911 s | 1078.9 ms | 101.5 ms |
| Application compression disabled, experiment only | 9.874 s | 690.5 ms | 96.6 ms |
| Route cache increased from 256 to 512 MiB, experiment only | 10.458 s | 697.5 ms | 88.1 ms |
| Current configuration at 0.5 vCPU | 11.990 s | 196.6 ms | 17.2 ms |

The experiments were sequential on one local host; small differences can include
host-cache/order effects. Removing validators saved only about 3.5% CPU here.
Removing application compression saved about 12.6%, but a public replacement
would need correct compressed HTML/RSC delivery, validators, Vary and accounting
for additional origin traffic. More route-cache memory cannot remove first-use
work and increases memory commitments. None matched the measured capacity
benefit well enough to justify changing public delivery behavior for this issue.

## Defined search implementation for Devin

`normalizeSearchText` repeatedly tests `endsWith(" ")` on a growing string,
which repeatedly flattens V8 strings. A 168000-character Hebrew fixture took
5704.73 ms at 0.25 CPU; an equivalent bulk transformation took 4.07 ms.
Equivalence passed all 1114112 Unicode code points in surrounding text and
10000 seeded random strings, including per-character case behavior.

```ts
return text
  .normalize("NFD")
  .replace(/[\p{Mn}\p{Mc}'"׳״‘’“”]/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()
  .replace(/\p{Changes_When_Lowercased}/gu, (char) => char.toLowerCase());
```

The actual image's compiled equivalent of this one function was replaced in a
private counterfactual. Eight requests, covering pasuk/article/perush/all search
twice, all returned 200. Sorted result/metadata hashes matched before and after,
including scores, snippets and links. CPU fell **8.892 -> 5.398 seconds**;
allocation fell **16.83 -> 2.41 GB**; GC events fell **962 -> 104**; unrelated
health p95 fell **2500.6 -> 182.3 ms**. Cold indexing and database waiting remain;
this does not claim every full search completes in four milliseconds.

The implementation is small, preserves the result contract and is worth doing.
[Devin task #2956](https://github.com/bible-on-site/bible-on-site/issues/2956) contains the reproduction, exact scope and acceptance
checks. It needs no AWS access. It does not replace capacity relief for the
observed cached-page bursts, which did not contain search requests.

## Cost, compatibility and rollout

The official [Israel Fargate price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/il-central-1/index.json)
lists Linux/x86 at $0.0518144 per vCPU-hour and $0.0056896 per GiB-hour.
For one task, unchanged 2 GiB and 730 hours/month:

| Allocation | Monthly CPU/memory estimate |
| --- | ---: |
| 0.25 vCPU / 2 GiB | $17.76 |
| 0.5 vCPU / 2 GiB | $27.22 |
| Increase | **$9.46/month**, about $0.31/day |

Other AWS services, storage, transfer, public IPv4 and taxes are excluded.
The independent ARM migration has different rates and must preserve the current
capacity when taking its own baseline. It is not bundled into this change.

Apply only a new live task-definition revision with task CPU changed to 512,
preserving the current memory, container settings, architecture, roles, secrets,
network/discovery and deployment/health/drain limits. Do not deploy the reference
CloudFormation stack wholesale. Snapshot the service and immutable running image,
check that ordinary deployment/migration is not concurrently replacing it, and
verify the new task uses the expected image and CPU before accepting rollout.
The existing `latest` release contract must continue to work.

Rollback is the captured source task definition with its verified source image;
it must not restore an outdated image over a concurrent release. Keep the old
healthy task through ordinary rolling readiness. Verify private/public health,
recitation, representative old/crawled URLs, and upstream timing after stability.
The rolling-hour UptimeRobot badge will reflect the new allocation gradually;
more CPU cannot remove the public request's network/TLS component.

The fresh database copy used explicitly approved temporary /32 access managed
by its returned rule ID. Removal and absence were verified. The legacy sync
helper's duplicate-rule cleanup bug was isolated from the research and receives
[implementation task #2957](https://github.com/bible-on-site/bible-on-site/issues/2957). No source database content
or public traffic policy was changed by the investigation.
