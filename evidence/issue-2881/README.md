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
- Loading the file at server boot would hide it from the first request but is
  the warmup the issue rules out.

No timeout, retry, sleep, warmup, preload flag or workload change was made.
