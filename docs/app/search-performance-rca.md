# Mobile search and reader performance root cause

The waits added by [PR 2177](https://github.com/bible-on-site/bible-on-site/pull/2177) and [PR 2193](https://github.com/bible-on-site/bible-on-site/pull/2193) hid defects in artifact delivery and the reader/search critical path. Longer interaction deadlines did not repair them.

## Evidence

[PR 2109](https://github.com/bible-on-site/bible-on-site/pull/2109) did implement compressed chapter blobs and a complete prebuilt Hebrew FTS index. Its [CI run 38178075348](https://github.com/bible-on-site/bible-on-site/actions/runs/38178075348) produced artifact 11716567220, containing a 62,795,776-byte notes DB, 40,960-byte catalog and 332,537,856-byte search DB. Both index fingerprints match the delivered notes and bundled scripture generations.

However, the same workflow retained the pre-existing `perushim-sqlite-v2.master` artifact identity. Artifact 11717096084 contained a 277,131,264-byte notes DB and catalog, with no search DB. Later, [PR 2193's CI run 38185604734](https://github.com/bible-on-site/bible-on-site/actions/runs/38185604734) restored that same 69,776,121-byte ZIP baseline (artifact 11719124112) for its iOS test job. The asset installer explicitly allowed a missing search DB and deferred construction to the device. The generated index therefore existed but was bypassed by baseline reuse.

Four regressions reproduce independently against the original implementation:

- A cold search captures the caller's UI synchronization context. SQLite awaits resume blob decoding and scoring on the dispatcher; the regression observes 25 dispatcher posts.
- A first verse query builds its own index without trying the already installed delivered index. A query for a marker present only in a compatible delivered index returns no hits.
- Adopting the delivered DB replaces verse tables while retaining their readiness flag. A notes-only delivered fixture leaves a subsequent verse query attempting a missing table.
- Reader initialization waits for speculative notes/verses around the requested chapter before publishing the carousel: up to 21 chapters, or 11 at Genesis 1.

## Repair

CI, mobile tests and release packaging now use `perushim-sqlite-v2-indexed.*`. This forces a new baseline with compressed notes and the complete index. Asset preparation rejects missing indexes, missing FTS/document/vocabulary tables, empty document payloads, incorrect normalization and mismatched notes or scripture generations before copying anything. Changes to bundled scripture also trigger regeneration.

The first verse query can adopt an already installed index. Atomic adoption clears readiness for both replaced tables. The entire search service, its independent build tasks and chapter result scoring run on workers. Reader initialization publishes only the requested chapter; immediate neighbors preload after the reader is visible. iOS ODR extraction also copies the large notes/index payload on a worker while preserving the native resource-access lifetime.

The added 2-, 3- and 8-minute interaction overrides are removed, restoring the ordinary 45-second mobile test deadline. The test-host hang guard returns from 18 to 10 minutes. Repository guidance explicitly prohibits extending waits, retries or watchdog limits to conceal performance failures.

## Local validation

All four new regressions fail against the original code and pass with the repair. The full unit suite passes 1,626 tests. Asset preparation passes 18 tests, including stale scripture rejection. CI change detection passes 34 tests. The mobile test harness passes 49 tests. Android compilation succeeds with zero warnings and zero errors.

A desktop harness uses the real full-corpus generated artifact from PR 2109 and the packaged scripture. These measurements include service queries but exclude native UI rendering and store asset delivery; they are not emulator performance claims.

| Operation | Original code | Fixed code |
| --- | ---: | ---: |
| Reader initialization after metadata load | 212.0 ms; 11 chapters loaded | 81.5 ms; 1 chapter loaded |
| First verse search, including cache setup/adoption | 1,641.3 ms | 738.6 ms |
| Warm verse search with fuzzy expansion | 115.2 ms | 131.2 ms |
| First commentary search after the verse query | 421.1 ms | 4.3 ms |
| Warm commentary search | 2.2 ms | 2.8 ms |

Warm verse search did not improve in this run. The repair removes corpus construction and speculative reader loading from the critical path; it does not change the existing fuzzy matching algorithm. Native Android and iOS CI validate the real UI against the restored interaction deadlines.
