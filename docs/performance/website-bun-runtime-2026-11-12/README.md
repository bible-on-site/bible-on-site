# Website production serving: Bun vs Node runtime benchmark

Local paired benchmark for [#3315](https://github.com/bible-on-site/bible-on-site/issues/3315):
does running the production Next.js standalone server under Bun improve serving
latency and CPU efficiency over Node?

**Recommendation: measured NO-GO for adoption at this time.** Bun does not win
consistently — it is faster on most medians, burst tail latency and CPU per
request, but exhibits intermittent multi-second stall episodes on the cached-RSC
delivery path, ~25–66% higher peak RSS, and the event-loop diagnostics silently
report unsupported metrics as healthy zeros. The Node baseline must be kept.
A native Linux/Fargate re-test is only worth Codex/Dorad effort if the Bun stall
cause is identified first; the harness and raw results here make that re-test a
re-run, not a rebuild.

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
  PowerShell sampler records process-tree CPU-seconds and RSS/peak RSS every
  ~400 ms — identical measurement for both runtimes.
- Harness: `web/bible-on-site/scripts/runtime-bench.mjs` (`run|report|sanitize`);
  raw per-request records in `raw/*.json.gz` (gzip so each trial stays under the
  repo's 500 KB file limit — `gzip -d` or any JSON+gzip reader to inspect),
  folded stats in `raw/summary.json.gz`.

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

In trial 1 the Bun server entered a ~25 s stall window: 73 of 343 RSC requests
exceeded 200 ms (several 1.8–4.0 s), spread across 200 flight payloads and 404s
alike — i.e. event-loop-level stalls, not per-path work.

Stall episodes are not Bun-exclusive — an earlier identical suite (4 workloads,
before the `rsc` workload existed) measured a pooled Node burst p95 of 6.15 s /
p99 8.85 s versus 896 ms / 1.25 s here, and a Bun apiMix p95 of 1.24 s. But the
Bun episodes are both more extreme (4 s stalls on a warm cached path) and strike
the workload production cares about most — cached RSC delivery — while Node's
episodes were confined to the intrinsically saturating burst replay.

### CPU and memory

| Metric | Node | Bun |
| --- | --- | --- |
| CPU-seconds, ordinary replay | 3.34 / 3.69 / 3.48 | 2.39 / 3.34 / 3.17 |
| CPU-seconds, burst replay | 11.77 / 12.70 / 10.22 | **5.66 / 5.72 / 5.56 (~50% less)** |
| Peak RSS | 528 / 528 / 576 MB | **652 / 656 / 956 MB (+25–66%)** |
| End-of-run RSS | ~513–526 MB | ~542–564 MB |

### Startup / cold readiness

| Metric | Node | Bun |
| --- | --- | --- |
| Ready (`/api/health/ready` 200 incl. warm) | 4389 / 3529 / 4098 ms | **2833 / 2417 / 2532 ms** |
| First-ever process start on this host | ~4.99 s | **27.5 s** (one-time Bun transpile-cache cold miss; amortizes per binary+artifact) |

### Errors and status distribution

Zero errors/timeouts in all runs; identical status histograms on both runtimes:
ordinary `{200:42, 307:1029, 404:9}`, rsc `{200:528, 404:501}`,
burst `{200:2151, 307:114, 404:123}`.

## Response-contract and compatibility evidence

Identical on both runtimes (per-request comparison, `raw/*-contract` fields):

- **Byte-identical decoded bodies** for HTML pages, the `?\_rsc` flight payload
  (83 623 B), recitation JSON and the server-action response — only the gzip
  wire encoding differs (±10–60 B, cosmetic zlib framing).
- RSC canonicalization: `?\_rsc=<nonce>` + `RSC: 1` → identical 307 to `?\_rsc`;
  explicit `RSC: 1` without the query marker → same 307.
- Middleware redirect `/tanahpedia/jerusalem` → identical 308 to
  `/pedia/ירושלים`; Hebrew percent-encoded routes serve identical statuses.
- ETag conditional GET → 304; HEAD → identical headers; `Accept-Encoding: gzip`
  negotiated, `br`-only client → identical identity response + `Vary`.
- Server action POST (`getBookshelfDedicationLines`) → byte-identical
  `text/x-component`; invalid action ID → identical 400.
- Mid-body client disconnect tolerated on both (post-abort health check 200).
- mysql2, JSDOM/DOMPurify (readiness warm), Sharp image optimizer, gzip — all
  exercised in-workload with identical statuses.

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

## Shutdown

On Windows the wrapper cannot exercise its POSIX `/proc/net/tcp` drain path and
`SIGTERM` does not run its drain handler; empirically the whole process tree
terminated within ~3 s on both runtimes. Drain/readiness-under-drain behavior is
therefore untested here and remains on the Linux qualification path — no
runtime-specific difference observed.

## Reproduce

```bash
cd web/bible-on-site
bun install && bun run build            # .dev.env must point at a populated DB
# one build serves both runtimes; 3 paired trials (~30 min):
node scripts/runtime-bench.mjs run \
  --fixture ../../docs/performance/website-cpu-2026-11-02/replay-fixture.json \
  --trials 3 --base-port 3400 \
  --workloads cold,ordinary,rsc,api,burst,contract \
  --out ../../docs/performance/website-bun-runtime-2026-11-12/raw
node scripts/runtime-bench.mjs report   --in ../../docs/performance/website-bun-runtime-2026-11-12/raw
# diagnostics variant (1s emit interval):
EVENT_LOOP_DIAGNOSTICS_INTERVAL_MS=1000 node scripts/runtime-bench.mjs run \
  --fixture <same> --trials 1 --base-port 3600 --workloads ordinary --diagnostics \
  --out <same raw dir>
# strip machine-local paths before committing raw evidence:
node scripts/runtime-bench.mjs sanitize --in <raw dir>
```

## Conditional follow-up (Codex/Dorad)

Per the issue's AWS gate: **N/A for now** — Bun is rejected on local evidence, so
native Fargate qualification, image publication and rollout work are not
warranted. If a future Bun release or a root-caused fix removes the stall
episodes and the memory regression, re-run this harness on the target platform
before reconsidering adoption.
