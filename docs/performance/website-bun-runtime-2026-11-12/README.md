# Website production serving: Bun vs Node runtime benchmark

Local paired benchmark for [#3315](https://github.com/bible-on-site/bible-on-site/issues/3315):
does running the production Next.js standalone server under Bun improve serving
latency and CPU efficiency over Node?

**Recommendation: keep Node in production; Bun remains a promising, unqualified candidate.**
Bun wins most medians, burst tail latency and CPU per request in these Windows
trials. Its higher memory use and one bad RSC trial block adoption, but these
measurements do not establish that Bun is intrinsically worse or that further
Linux testing is unwarranted. The load generator also fell behind during the
bad trial, so the server-stall attribution is unresolved. Production serving,
capacity, public URLs and deployment configuration are unchanged by this PR.

The November 13 independent review recalculated the committed evidence and fixed
the harness; it did **not** rerun the application benchmark. The original raw
trials remain unchanged. The regenerated summary and paired compatibility report
are in `raw/summary.json.gz` and `raw/compatibility.json.gz`.

## Environment and artifact (all held constant)

| Property | Value |
| --- | --- |
| Source SHA | `385864c22cd09192e93850051f9bd50a5666a7d9` |
| Website / framework | 0.2.653 / Next.js 16.4.5 (Turbopack build) |
| Node runtime | v26.13.0 (fnm) — matches `node:26.13.0-alpine` Dockerfile base |
| Bun runtime | 1.4.4 — matches `oven/bun:1.4.4-alpine` Dockerfile copy |
| Platform | Windows 11 x64 native, i7-5930K (12 logical CPUs), 32 GiB |
| Database | MySQL 8.4.9 native, `tanah-dev` (prod-synced: 35 sefarim / 929 perakim) |
| Artifact | single `bun run build` → `.next/standalone` (`BUILD_ID _qpyP3ANNJRri-hyRRqj0`, `server.js` sha256 `146add09…`) |
| Entrypoint | `scripts/start-server.mjs` under `node` and under `bun`; the wrapper propagates `process.execPath` to `server.js` (verified per run: children were `node.exe` / `bun.exe`) |
| Env | `NODE_ENV=production`, `PORT`, `HOSTNAME=127.0.0.1`, `.dev.env` (`DB_URL`, dev S3 settings) |

**Scope limits.** Numbers are native-Windows measurements, not the Alpine/Fargate
target — treat them as directional evidence, not a production SLA. `?ssl-mode`
and S3 (RustFS) were as in `.dev.env`; S3 object fetches were not part of the
route set. `/?_rsc=<nonce>` replays exercise the 307 canonicalization hop; the
delivered flight payload is measured by the dedicated `rsc` workload on the
canonical `?\_rsc` form.

## Method

- One build artifact serves both runtimes; each run is a fresh wrapper+server
  process tree on an alternating port (paired trials, alternating runtime order,
  3 trials per runtime).
- Workloads per instance: readiness wait → cold first-hit probes → `ordinary`
  replay (360 logged public paths at 5 starts/s, `RSC: 1` on `_rsc`-marked
  URLs) → concurrent `/api/health/ready` at 1/s → `rsc` replay (343 canonical
  `?\_rsc` flight requests at 5/s) → API/server-action mix → `burst` replay
  (796 recorded-burst requests on their second offsets) → contract checks.
- Per request: TTFB (headers) and complete duration, status, bytes. External
  PowerShell sampler records process-tree CPU-seconds and working set every
  ~400–700 ms (the requested 400 ms plus sampler overhead) — identical measurement for both runtimes.
- Harness: `web/bible-on-site/scripts/runtime-bench.mjs` (`run|report|sanitize`);
  raw per-request records in `raw/*.json.gz` (gzip so each trial stays under the
  repo's 500 KB file limit — `gzip -d` or any JSON+gzip reader to inspect),
  folded stats in `raw/summary.json.gz`; paired contracts in
  `raw/compatibility.json.gz`. Memory values below are MiB (bytes / 2^20).

## Results (pooled 3 trials, TTFB ms)

| Workload | Node p50 / p95 / p99 | Bun p50 / p95 / p99 | Reading |
| --- | --- | --- | --- |
| Cold first-hit probes (n=36) | 21.4 / 370 / 390 | 18.6 / 203 / 289 | Bun better |
| Ordinary replay (n=1080; mostly 307 hops + 42 HTML + 9 404) | 3.5 / 14.6 / 34.3 | 2.3 / 10.2 / 19.5 | Bun better |
| Concurrent health during ordinary (n≈211) | 7.6 / 15.7 / 35.7 | 6.1 / 11.5 / 15.2 | Bun better |
| **RSC canonical `?\_rsc` (n=1029)** | 7.7 / 33.7 / 44.4 | 6.4 / **653 / 3221** | Bun median better; **tail episodes up to ~4 s** |
| API + server-action mix (n=198) | 11.9 / 211 / 942 | 7.9 / 131 / 206 | Bun better |
| Burst replay (n=2388) | 488 / 896 / 1250 | 259 / 412 / 650 | **Bun ~2× better tail** |

Per-trial RSC p95 exposes the inconsistency the pooled row hides:

| Trial | Node rsc p95 | Bun rsc p95 |
| --- | --- | --- |
| 0 | 42.3 | 9.1 |
| 1 | 10.8 | **2702.6** |
| 2 | 11.0 | 10.3 |

In Bun trial 1, 73 of 343 RSC requests exceeded 200 ms. Their starts span
14.01–39.61 s of the workload; the maximum TTFB was about 4 s. Both 200 and 404
responses were affected. The other two Bun trials had zero RSC requests above
200 ms, as did all three Node trials.

**Attribution is not established.** Recomputing client scheduling error as
`startedAtMs - index * 200` gives a maximum of **933.94 ms** in Bun trial 1,
versus 18.85/23.95 ms in its other trials and 58.80/18.51/17.90 ms for Node.
The harness, server and PowerShell sampler shared one unconstrained Windows
host. This indicates client/host interference as a possible contributor; it
neither proves Bun event-loop stalls nor explains away the longer response
latencies. The separate diagnostics runs did not capture this RSC episode.
There were no simultaneous health probes during RSC or burst in these trials.
New runs record scheduled starts and scheduling lateness explicitly.

The earlier suite mentioned in the original report is not committed here and
cannot establish how often Node or Bun stalls. Three short pairs cannot establish
incident frequency, a production tail SLA or sustained-load memory stability.
Also, 501/1029 RSC responses are 404s; the selected commentary cold/contract
route is a 404. This measures a historical corpus, not complete current dynamic
commentary coverage. Such probes must use known populated routes in qualification.

### CPU and memory

| Metric | Node | Bun |
| --- | --- | --- |
| CPU-seconds, ordinary replay | 3.34 / 3.69 / 3.48 | 2.39 / 3.34 / 3.17 |
| CPU-seconds, burst replay | 11.77 / 12.70 / 10.22 | **5.66 / 5.72 / 5.56 (~50% less)** |
| Sampled simultaneous process-tree working-set peak, trial 0/1/2 | 573.22 / 525.76 / 528.64 MiB | **954.85 / 643.44 / 643.89 MiB (+66.6% / +22.4% / +21.8%)** |
| Final five sampled working sets, median (includes teardown window) | 512.73 / 525.76 / 528.64 MiB | 541.72 / 553.68 / 563.79 MiB |

The original peak metric summed each process's historical peak, even if those
peaks occurred at different times. The corrected value is the maximum observed
sum of current working sets. Sampling can miss shorter peaks, and Windows
working set is not container RSS/cgroup memory. The regression remains after
correction. Bun uses about 6–7% more memory in the final-five-sample medians.
Legacy Node trial 2's last sample is only 114.13 MiB because a child had exited;
it must not be called steady-state memory. New runs snapshot samples before
shutdown. A five-second quiet tail is not a sustained-load or leak test.

### Startup / cold readiness

| Metric | Node | Bun |
| --- | --- | --- |
| Ready (`/api/health/ready` 200 incl. warm) | 4389 / 3529 / 4098 ms | **2833 / 2417 / 2532 ms** |
| First-ever process start reported by the original author (not in committed trials) | ~4.99 s | **27.5 s**; cause and repeatability unverified |

Do not assume the 27.5 s startup is a one-time cost that disappears in containers.
Bun documents a host transpiler cache and notes that its Docker images disable
it; fresh-task readiness requires its own cold-cache measurement. See
[Bun environment variables](https://bun.com/docs/runtime/environment-variables).

### Errors and status distribution

Zero errors/timeouts in all runs; identical status histograms on both runtimes:
ordinary `{200:42, 307:1029, 404:9}`, rsc `{200:528, 404:501}`,
burst `{200:2151, 307:114, 404:123}`.

## Response-contract and compatibility evidence

The corrected report pairs all three normal trials and compares named probes,
statuses, decoded hashes and recorded response headers. All recorded semantic
contracts pass. It explicitly exposes two JSON Content-Type spelling differences
per pair: Node returns `application/json`; Bun adds `;charset=utf-8`. This is
normalized only for JSON UTF-8 semantics; other header differences fail.
The diagnostics-only pairs are marked `not-assessed` for contracts.

- **Byte-identical decoded bodies** for HTML pages, the `?\_rsc` flight payload
  (83 623 B), recitation JSON and the server-action response — only the gzip
  wire encoding differs (±10–60 B, cosmetic zlib framing).
- RSC canonicalization: `?\_rsc=<nonce>` + `RSC: 1` → identical 307 to `?\_rsc`;
  explicit `RSC: 1` without the query marker → same 307.
- Middleware redirect `/tanahpedia/jerusalem` → identical 308 to
  `/pedia/ירושלים`; Hebrew percent-encoded routes serve identical statuses.
- ETag conditional GET → 304; HEAD → matching recorded headers; `Accept-Encoding: gzip`
  negotiated, `br`-only client → identical identity response + `Vary`.
- Server action POST (`getBookshelfDedicationLines`) → byte-identical
  `text/x-component`; invalid action ID → identical 400.
- Mid-body client disconnect tolerated on both (post-abort health check 200).
- mysql2, JSDOM/DOMPurify (readiness warm), Sharp image optimizer and gzip were
  exercised; this is not comprehensive feature qualification.

The legacy evidence did not hash every probe (listed explicitly under
`unrecordedBodyProbes`), and did not record cache-control. New contract probes
collect decoded bodies and cache-control, derive both action IDs from the served
standalone artifact's server-reference manifest, and require a fulfilled action
flight result (HTTP 200 alone is insufficient). Reports fail on response
mismatches, failed probes, missing pairs or duplicate evidence. An empty input
fails before writing a summary. Wire-byte differences from compression are not
body mismatches.

## Diagnostics gap (compatibility finding)

With `ENABLE_EVENT_LOOP_DIAGNOSTICS=1` (`raw/trial0-*-diag.json`):

- **Node**: real `eventLoopDelay` histogram, `eventLoopUtilization`
  (idle/active/utilization), per-window `cpu.userMs/systemMs`, `gc`
  counts/durations/kinds.
- **Bun**: `eventLoopDelay` works; **`eventLoopUtilization` reports
  `{idleMs:0, activeMs:0, utilization:0}` and `gc` reports `count:0` on every
  window** — the exact "unsupported metrics as healthy zeros" failure called out
  in the issue. `cpu` is also near-always zero.

Required pre-adoption fix (not applied in this change): detect the unsupported
primitives on Bun and report them as explicitly unavailable rather than 0;
external process metrics (as used here) remain the cross-runtime substitute.
Tracked as a compatibility blocker in
[#3351](https://github.com/bible-on-site/bible-on-site/issues/3351).

## Shutdown

On Windows the wrapper cannot exercise its POSIX `/proc/net/tcp` drain path and
`SIGTERM` does not run its drain handler; empirically the whole process tree
terminated within ~3 s on both runtimes. Drain/readiness-under-drain behavior is
therefore untested here and remains on the Linux qualification path — no
runtime-specific difference observed.

## Reproduce

`run` currently supports **native Windows only**. It rejects other platforms
before launching a process. `report` and `sanitize` support both plain JSON and
gzip JSON on all platforms. A Linux process-sampling/lifecycle adapter is still
a prerequisite for native Linux qualification; this is not a ready Fargate harness.

From `web/bible-on-site`, in PowerShell:

```powershell
bun install --frozen-lockfile
bun run build  # .dev.env must point at a populated isolated DB
# Use a new directory to preserve the historical evidence:
node scripts/runtime-bench.mjs run --fixture ../../docs/performance/website-cpu-2026-11-02/replay-fixture.json --trials 3 --base-port 3400 --workloads cold,ordinary,rsc,api,burst,contract --out runtime-bench-out
# Regenerate published summaries without decompressing trial files:
node scripts/runtime-bench.mjs report --in ../../docs/performance/website-bun-runtime-2026-11-12/raw --out runtime-bench-report
# Diagnostics variant; remove the env variable after this command:
$env:EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS = '1000'
node scripts/runtime-bench.mjs run --fixture ../../docs/performance/website-cpu-2026-11-02/replay-fixture.json --trials 1 --base-port 3600 --workloads ordinary --diagnostics --out runtime-bench-diag
Remove-Item Env:EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS
# Sanitize before committing; gzip inputs remain compressed:
node scripts/runtime-bench.mjs sanitize --in runtime-bench-out
node --test scripts/runtime-bench.test.mjs
```

The driver also checks paired contracts at the end of a run. The report accepts
`--gzip` for compressed summary/compatibility output. Sampler startup/failure is
handled explicitly; cleanup retains child PIDs and verifies termination before
another instance starts. Health probes now use their own agent and pending
probes finish before the workload is recorded. These fixes improve future runs;
they do not retroactively qualify the historical timings.

## Conditional follow-up (Codex/Dorad)

**This PR performs no AWS qualification or rollout.**
Keep [#3315](https://github.com/bible-on-site/bible-on-site/issues/3315) open for
the remaining qualification rather than closing it as a definitive Bun rejection.

| Option | Benefit | Tradeoff / decision |
| --- | --- | --- |
| Keep Node serving; keep using Bun for existing tooling | Preserves the validated serving baseline | Recommended production choice today; serving CPU opportunity remains |
| Add a native Linux adapter, then run isolated paired tests at the verified target architecture/resource limits with a separate load-generator process/host | Tests whether Windows interference and unconstrained memory policy explain the regressions | Recommended next investigation; first reproduce/profiling locally, no public production load |
| Profile the RSC episode with client lateness, independent concurrent health, server CPU/loop delay, memory and GC evidence | Distinguishes client/host pauses from server blocking, compression or GC hypotheses | No root cause can be claimed until correlated; do not increase timeouts to hide it |
| Compare default Bun with memory-saving mode in separate, labeled experiments | May reduce the measured memory overhead | Bun's [`--smol` option](https://bun.com/docs/runtime#bun-run-smol) trades performance for more frequent GC; the launcher must demonstrably propagate settings to the server child before trusting results |
| Repair unsupported diagnostics before any adoption | Prevents false healthy utilization/GC zeros | Tracked in [#3351](https://github.com/bible-on-site/bible-on-site/issues/3351); external CPU/memory and supported loop-delay metrics remain necessary. [Bun documents these gaps](https://bun.com/docs/runtime/nodejs-compat) |

Qualification also needs valid dynamic commentary/article/export/cache-revalidation
cases, repeated cold-cache task starts, longer steady-load memory tests and real
SIGTERM/readiness/drain checks. Control the transpiler-cache policy and cgroup
limits, record actual parent/child runtime options, keep timeouts/capacity
unchanged, and retain Node as the comparison and rollback. The present data show
an attractive CPU/latency opportunity plus unresolved tail and memory risks;
they support **no production switch yet**, not **Bun is worse overall**.

Any later AWS-impacting runtime/deployment PR requires Dorad's explicit approval
of that PR's current changes. This benchmark PR contains no production runtime,
AWS resource, deployment, DNS, cache or public-URL changes. Its rollback is a
repository revert of benchmark tooling/docs; the running production service is
unaffected.
