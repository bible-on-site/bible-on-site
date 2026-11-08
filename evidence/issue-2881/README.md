# Issue #2881 — Windows cold-start Sefer deadline: first-request critical path

Windows Server 2022, 8 vCPU / 32 GB, Node 26.13.0, Bun 1.4.4, Next 16.4.3,
local MySQL 8.4 `tanah_test` (db-populator), master `e6787d99`.
One normal `bun run build` (4,247/4,247 pages, ~3m17s), then the standalone
server started fresh for every sample. "Cold" = Windows standby list emptied
(`RAMMap64 -Et`) before the server starts, so the OS file cache no longer
holds the build output. Deadline, workload, clicks and spacing unchanged.

## Standard test (`tests/perf/sefer-flip-lag.test.ts`, Desktop, 1 worker)

Four fresh-server runs on this build: `2 passed` each, suite 34.0 / 34.5 /
35.1 / 34.8 s, click route ratio 0.96–0.98x. No recurrence of the failure.

## Request timeline (external Playwright driver, nothing injected into the app)

First `/dev/sefer/125` navigation:

| | server ready | `goto` | readiness |
| --- | --- | --- | --- |
| warm | 547–594 ms | 408–416 ms | 715–831 ms |
| cold | 1,232–1,292 ms | 1,979–2,084 ms | 1,351–1,365 ms |

Later navigations are tens to hundreds of ms with readiness under 1 s, warm or
cold. The difference is the first document.

Server-only TTFB (`curl`, after the server answered its readiness probe):

| | first `/dev/sefer/125` | `/929/125?book` |
| --- | --- | --- |
| warm | 0.295–0.344 s | 0.013–0.040 s |
| cold | 1.374–1.455 s | 0.013–0.040 s |

Unsetting `S3_ENDPOINT` does not materially change the cold first request.
Pre-reading the standalone server chunks into the file cache before a cold
start still left ~1.35–1.49 s first-request TTFB.

## Cause

A `--require` hook timing slow `require` / `fs.readFile*` calls and
request start/end in the standalone server:

```
cold: 1649 req.start /dev/sefer/125
      1690 readFileSync 1047.7 ms  .next/standalone/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json
      3024 res.end     /dev/sefer/125
      3050 req.start   /929/125?book   -> 3085 res.end
warm:  617 readFileSync   44.1 ms  (same file), first request 588 -> 903
```

`canonicalSefarim()` in `src/data/db/sefarim.ts` reads this 40 MB
(39,998,731-byte) JSON synchronously on the first dynamic request, then
`JSON.parse` takes ~160 ms. With a cold file cache the read alone blocks the
event loop for ~1 s, which accounts for most of the cold-vs-warm first-request
gap. Later requests hit the global cache.

Sustained concurrent disk writes (4 × 1.5 GB) during a cold start gave the
same read time (1,016–1,108 ms), so post-build writeback is not shown to make
it worse. This read explains ~1 s of cold variance, not the full 5.8 s first
navigation in the original failure (whose capture also contained the 4.3 s
optimized header-logo request already removed in #2871).

## Options (not applied here)

- Brotli-compress the canonical JSON at build time and decompress at load:
  40.0 MB → 3.9 MB (quality 9, ~1.4 s once per build), decompression 70–91 ms
  measured ad hoc. Expected cold read ~0.1 s instead of ~1 s; small warm cost.
  Touches the standalone tracing include, the image contents and the
  build-verification script, so it needs a maintainer decision.
  (Landed as #2914.)
- Loading the file at server boot would hide it from the first request but is
  the warmup the issue rules out.

No timeout, retry, sleep, warmup, preload flag or workload change was made.

---

# Follow-up at `ab4fe9cc` (post-#2914 Brotli corpus, post-#2982 readiness)

Same machine class (12 logical CPUs / 32 GB, Windows, Node 24.21.0,
Bun 1.4.4, local MySQL `tanah_test`, Defender real-time protection enabled).
Driver: `measure-cold.mjs` (spawns `.next/standalone/server.js` with the
`--require` hook in `require-hook.cjs`, launches Chromium, and times the same
phases the test pays inside its 20 s window). `contend.mjs` + `burn.mjs`
generate load (CPU burners + a multi-GB streaming write — watch free space).
The scripts are attached to the #2881 issue comment rather than committed.

## Standard test (`tests/perf/sefer-flip-lag.test.ts`, Desktop, 1 worker)

| Conditions | Click test | Drag test |
| --- | --- | --- |
| First run after fresh `bun install` + first `bun run build` (fresh worktree) | **FAIL — timeout 20.4 s** (during 4th click batch) | pass 15.6 s |
| Same build, ~20 min later (warm) | pass 12.2 s | pass 15.2 s |
| Immediately after a second `bun run build` | pass 13.5 s | pass 13.0 s |
| Same warm build + induced contention (10 CPU burners + streaming disk writer) | **FAIL — timeout >20 s** | **FAIL — timeout >20 s** |

Flake signature reproduces (timeout mid-`rapidFlips`), but only when ambient
load is high; a fully warm suite has ~7.5 s of slack.

## Request timeline (fresh worktree, first run after `bun install` + build)

| Phase | cold (first postbuild run) | warm (later runs) |
| --- | --- | --- |
| server spawn → port open | 573 ms | 545–557 ms |
| readiness `GET /` (server-side) | 731 ms | 159–881 ms |
| Chromium launch | **1,377 ms** | 90–103 ms |
| `GET /dev/sefer/125` TTFB | 807 ms | 707 ms–1,172 ms |
| `GET /dev/sefer/125` full nav (client `load`) | 1,039 ms | 897–1,378 ms |
| `GET /929/125?book` | 31–144 ms | 26–124 ms |
| `waitForFlipBook` per nav | 452–699 ms | 344–656 ms |
| click batch (6 clicks + settle) | ~1.9–2.2 s | ~1.9–2.2 s |

The 1.4 s cold Chromium launch matches the issue's retained 1,413 ms sample.
Everything else on the cold path is bounded one-time process work:

- server boot `require`s ≈ 450 ms (Next internals; none per-route — the route
  bundles load on the `GET /` readiness hit via the shared SSR chunk);
- canonical corpus `brotliDecompressSync`+`JSON.parse`: 77–84 ms + 470–536 ms
  synchronous, once per process, on the first dynamic request;
- mysql pool + 2 queries on `/dev/sefer`: small;
- `isomorphic-dompurify` → jsdom `require` chain: ~2.0–2.3 s, but only on the
  `/api/health/ready` path (that call itself takes 3.7–6.7 s cold) — it is not
  on the sefer test path.

Client-observed first navigation = server TTFB + ~25 static chunk/CSS/font
fetches + parse/exec + hydration start; `waitForFlipBook` then covers book
init. Under ambient load every component inflates roughly uniformly (~1.7–2×)
— no single blocking call dominates; the induced-contention run fails purely
by multiplying fixed work past the fixed deadline.

## Negative result: `NODE_COMPILE_CACHE`

Evaluated for the standalone server: first spawn is *slower*
(port 2,558 ms, `GET /` 3,249 ms, `/dev/sefer` 2,880 ms — cache write cost),
and Playwright kills the webServer before Node's exit-time cache flush runs
(the cache dir stayed empty — 0 bytes), so later spawns see no benefit.

## Host observations

- `C:` was at ~0–18 GB free of 953 GB during these sessions (multiple
  worktrees + `.next` outputs). Near-full NTFS plus real-time protection is a
  plausible amplifier of the post-build variance window; not proven causal.
- The genuine cold recurrence needs post-build timing *and* ambient load; a
  fresh worktree's first run alone passed at ~15 s.

No timeout, retry, sleep, warmup, preload flag or workload change was made.

