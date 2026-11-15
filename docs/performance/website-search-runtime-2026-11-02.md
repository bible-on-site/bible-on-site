# Website search runtime latency, 2026-11-02

Website 0.2.608 passed native x86 cold startup with SOCI in 80.566 seconds and all 3,713 public page requests, but its first all-provider search missed the existing two-second deadline without receiving response headers. ARM qualification did not start. The isolated AWS test resources were independently confirmed removed; production stayed on x86.

The published image reproduced the search timeout locally. A CPU profile showed scripture scoring and allocations before the database work could run. The search orchestrator now schedules database providers first and yields one event-loop turn before synchronous scripture scoring. Medium-length terms use an allocation-free one-edit scan instead of constructing a Levenshtein matrix for each word. Longer-term scoring retains the general algorithm.

## Controlled source comparison

Both source bundles ran against the same fresh read-only production snapshot restored into an owned local database: 93 reviewed public tables, 348,744 rows, including 339,715 commentary notes. Website containers used 0.5 CPU and 2 GiB; MySQL used 1 CPU and 2 GiB. Each bundle started in a fresh process. The unchanged baseline was commit `f0bf865b1e5f6e8f4b0e0635978fc407c2f8f3ec`; the candidate changed only search scheduling and bounded edit-distance scoring.

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| First all-provider source search | 1,974.24 ms | 1,709.05 ms |
| Second all-provider source search | 1,637.32 ms | 1,476.25 ms |
| Scripture-only search | 134.35 ms | 34.34 ms |

All eight paired responses (two complete searches and each of the six individual providers) retained identical result hashes, counts and availability. The complete response result hash was `988756e443f080cf823400030893e94f2e53acacd0cf71d087b01fb38bf0d7a6`. SQL statements and candidate selection did not change. An independent full-matrix reference also verifies one-edit acceptance and distances across empty, repeated, Hebrew and astral-character inputs.

These are source-level diagnostic measurements, not successful published-image or ARM qualification. Database cache state and runtime overhead affect timing. Full native qualification of the resulting published release remains mandatory, with the original two-second request deadline and zero retries. No timeout, retry, polling, capacity, schema, public URL or production content change is part of this fix.
