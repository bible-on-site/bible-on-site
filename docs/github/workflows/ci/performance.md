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

PR runs now cancel superseded runs of the same pull request, freeing runner
capacity for its newest commit. Master, manual and merge-queue runs use their
unique run IDs and are neither serialized nor cancelled by this rule. This
reduces wasted work and queue pressure without removing validation of the
commit that can merge.

## Native parallel steps

[GitHub introduced native parallel steps on June 25, 2026](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/).
Data CI uses `background: true` for its MongoDB image download after disk cleanup
and Cargo cache restoration. Lint, formatting, MySQL setup and unit coverage run
while the shell downloads to `/tmp`. An explicit `wait` precedes Docker loading
and integration tests, so download failures still fail the job. This can hide
part or all of the 105–180-second download in representative runs; disk loading
and integration tests remain sequential.

A native `parallel` group for the eight baseline uploads was tested, then
rejected for reliability. It passed several runs but failed in
[run 36917969213](https://github.com/bible-on-site/bible-on-site/actions/runs/36917969213)
when `actions/upload-artifact` parsed an empty GitHub event payload. This matches
[the open parallel-action startup race](https://github.com/actions/checkout/issues/2484)
and [the pending toolkit fix](https://github.com/actions/toolkit/pull/2464).
Uploads therefore remain sequential. The retained background shell uses `gh api`
and does not read the runner's shared event payload through the Actions toolkit.

Benchmarks do not overlap with extra workload, and Cargo commands sharing one
target directory and tests sharing a database remain sequential. No background
step is allowed to outlive a dependent consumer.

Upstream actionlint 1.7.12 rejects the new syntax. The pre-commit hook uses an
immutable Astral fork revision with native syntax/reference validation and the
existing Pyflakes integration; no lint rules are disabled. See
[the pre-commit documentation](../../../devops/pre-commit.md).

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
- Baseline restoration still copies both large perushim artifacts on every run,
  with uploads kept sequential. Avoiding the copies needs coordination with
  consumers and baseline retention; this change keeps that artifact contract.

No test selection, coverage thresholds, retries, performance thresholds, build
flags or release triggers are relaxed.

## Validation on this change

[PR run 36905961463](https://github.com/bible-on-site/bible-on-site/actions/runs/36905961463)
passed all module checks, iOS, website production performance, coverage and the
aggregate CI gate. Website CI took 4m36s and Website Performance 7m00s. These are
single-run observations, not controlled before/after benchmarks.

The rejected upload-parallelism experiment took 39s compared with the historical
52s baseline-job median, but its later startup race outweighed that saving.
The retained Data image download took 170s
and completed during lint/unit work, leaving the explicit wait at 0s.

The first merge-queue run exposed an existing website hydration race. Local
browser reproduction showed the initial URL effect hiding a book after a
replayed user click had opened it. The fix preserves that user choice, with a
regression test that fails before the fix. After the fix, all 986 website unit
tests and 20 consecutive local open-and-swipe browser repetitions passed.
Website E2E HTML/JUnit reports now
upload on failures too, so future CI diagnoses retain their evidence. Test
assertions, retries and timeouts remain unchanged.

The Data logs also exposed missing JUnit artifacts in Data and Bulletin: their
nextest paths resolved under `target/nextest/.junit-report` rather than the module
root. Correct the paths to match the already-correct API configuration, and fail
artifact upload if an expected report is missing. An isolated nextest fixture
reproduced the old location and verified both corrected Data profiles. See
[nextest's JUnit path rules](https://nexte.st/docs/machine-readable/junit/).

Transfer time remains variable: the first merge-queue Data run spent 12m32s in
`gh api` before ZIP extraction started, versus the 170s combined transfer and
extraction in the earlier PR run. This was the same cached image artifact. The
parallel step preserves the download and wait boundary; it cannot remove
remote transfer variability.

A final log audit found Website CI masking an LCOV post-processing failure with
`continue-on-error`: Docker's root-owned output was not writable by the runner
when Node added repository path prefixes. Run the LCOV container with the caller's
UID/GID on POSIX hosts and require coverage merging to succeed. A Linux volume
fixture reproduced `EACCES` with the original command and verified merging plus
Node rewriting with the corrected ownership; Windows keeps Docker Desktop's
existing bind-mount mapping.

Also preserve explicit `false` in the Codecov status check: jq's `//` fallback
previously converted both `false` and `null` into the unresolved state. The gate
now distinguishes pass, fail and unresolved responses; null-handling policy is
unchanged. Verified all three inputs with jq before and after the correction.
