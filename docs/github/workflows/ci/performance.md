# CI performance review: 2026-10-01

## Measurement

Inspected 150 recent Continuous Integration runs, then sampled 11 successful runs
from September 28 through October 1 that cover all six modules and iOS. Durations
below come from GitHub's job start/completion timestamps, excluding queue time.
Skipped jobs are excluded. This is a targeted sample, not a random benchmark;
cache state, runner contention, changes and retries differ between runs.

| Module/job | Samples | Median | Range |
| --- | ---: | ---: | ---: |
| Website CI | 10 | 12m37s | 7m38s–17m26s |
| Website Performance | 10 | 8m09s | 5m56s–8m54s |
| API CI | 7 | 3m00s | 2m33s–7m22s |
| Admin CI | 6 | 3m29s | 3m04s–10m18s |
| App CI | 6 | 4m08s | 3m29s–4m37s |
| App iOS CI | 3 | 2m13s | 1m44s–3m27s |
| Bulletin CI | 6 | 1m25s | 1m11s–7m05s |
| Data CI | 7 | 13m11s | 10m31s–17m27s |
| Perushim Data | 2 | 16m25s | 14m37s–18m13s |
| Package Website | 5 | 26m11s | 22m56s–27m38s |
| Package API | 2 | 12m59s | 9m29s–16m28s |
| Package Bulletin | 1 | 12m19s | Single sample |
| Shared baseline restoration | 11 | 52s | 45s–1m08s |

Representative sources: [website PR](https://github.com/bible-on-site/bible-on-site/actions/runs/36901617401),
[website release](https://github.com/bible-on-site/bible-on-site/actions/runs/36887111955),
[API release](https://github.com/bible-on-site/bible-on-site/actions/runs/36849900339),
[all modules and releases](https://github.com/bible-on-site/bible-on-site/actions/runs/36554492526),
[all-module warm run](https://github.com/bible-on-site/bible-on-site/actions/runs/36535973512),
[all-module cold run](https://github.com/bible-on-site/bible-on-site/actions/runs/36496030623),
[iOS](https://github.com/bible-on-site/bible-on-site/actions/runs/36533152641).
The remaining sampled run IDs are 36846771883, 36634846930, 36548179802 and 36522896292.

## Changes that preserve validation

- **Website:** remove the production build from Website CI. Its E2E launcher
  always starts `next dev`, so it does not consume the production output.
  Website Performance still builds the same source and tests its standalone
  server. It now also runs when the website coverage baseline is missing, and
  Cross Module CI requires it to succeed in that case. No production-build gate
  is lost. Remove the unused production cache transfer and let the E2E launcher
  populate its database once, keeping the same perushim SQL input and health checks.
- **Website/Admin:** precompile only `db-populator`, plus `s3-populator` for Admin.
  Compiling the whole data workspace also built unrelated MongoDB/pipeline tools.
  Data CI still runs its complete lint, unit and integration coverage suites.
- **API:** remove Chromium binary caching and installation of browser/system
  dependencies. Every API test uses the HTTP request fixture or `node:http2`;
  none launches a browser. The same E2E and coverage commands still run.

The removed Website CI steps consumed **169–286 seconds per sampled run**, with
an exact median of **254.5 seconds** (about 4m15s), excluding any benefit from the
smaller Rust build. This is historical avoidable work, not a measured prediction
of total workflow speedup: another parallel job can become the critical path.
API browser setup took about 19–24 seconds in the representative warm/cold runs,
plus cache overhead. Rust savings depend strongly on cache state.

## Remaining costs

- Website production packaging is the longest release path. In run 36887111955,
  the Docker build took 20m57s, including roughly 14m41s for its build layer;
  cleanup took 2m39s, image export 29s, gzip 61s, and upload 16s. Migrating the
  legacy Docker builder merits separate measurement of RDS connectivity, fresh
  SSG data and cache invalidation before claiming equivalent output.
- Data jobs spend minutes downloading/loading the large Sefaria MongoDB image,
  reclaiming disk and running integration coverage. Those operations remain;
  removing them would require another way to supply the same test dataset.
- Bulletin's warm CI is short; its cold run is mostly Rust compilation. App's
  dominant step is integration coverage (about 134–148 seconds in representative
  runs). These checks remain intact.
- Baseline restoration copies both large perushim artifacts on every run.
  Avoiding the copies needs coordination with consumers and baseline retention;
  this change leaves that artifact contract intact.

No test selection, coverage thresholds, retries, performance thresholds, build
flags or release triggers are relaxed.
