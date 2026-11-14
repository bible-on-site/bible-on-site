# Website performance reports

From `web/bible-on-site`, install the locked dependencies with `bun install
--frozen-lockfile`. Install Chromium once with `bun x playwright install chromium`,
or use an existing Chrome installation with `--channel chrome`.

## Collect production evidence on demand

```sh
bun run perf:production --save-assets
bun run perf:production --url https://xn--febl3a.co.il/929/1 --device mobile --runs 3 --save-assets
```

The default collects three fresh-browser Lighthouse samples for each of the
homepage and `/929/686`, on mobile and desktop. It needs no local website build,
database, AWS credentials or changes to the production service. Each sample uses
Lighthouse's standard device/throttling configuration and storage reset, without
a warm-up navigation. Keep other intensive work idle when comparing runs.

Output is saved under `.playwright-report/production/<timestamp>/`:

- `summary.md`: per-page/device medians, a representative sample's findings,
  exact resource URLs, selectors, source locations, byte/time savings, warnings
  and links to complete evidence. Estimates overlap; do not add them together.
- `summary.json`: every sample, settings, failures, diagnostic details and field
  data status. A runtime error is excluded from medians and produces exit code 1.
- Separate Lighthouse JSON and HTML reports for every URL/device/run. Hashed URL
  identifiers avoid filename collisions between paths and query strings.
- With `--save-assets`, `assets/` contains the flagged first-party static CSS/JS
  bytes, with original URLs and SHA-256 checksums in the summary. Third-party
  scripts and dynamic endpoints are not downloaded by this option.

Use `--output DIR` to keep a comparison outside the default folder. Use `--help`
for all options. A failed later sample leaves completed evidence on disk.

## Real-user data

Set `CRUX_API_KEY` in the process environment to query Google's CrUX API for
rolling collection-period p75 data. The script records page and origin records
separately for PHONE/DESKTOP, preserving the collection dates. Origin data is
never presented as a measurement of one specific page. Keys are sent in a header
and are not included in saved reports. `--skip-field` disables these queries.

Without a key, with insufficient CrUX traffic, or on an API error, the report
explicitly says field data is unavailable. Browser audits of production remain
lab data. Their TBT is not real-user INP and their repeated-run median is not p75.

## CI reports

The Website Performance job uploads `website-perf-diagnostics-<run>` for 14 days,
including full Lighthouse JSON, summaries and Web Vitals measurements. Accepted
Lighthouse issues retain their evidence and are labeled as exemptions instead of
disappearing from the report. Lighthouse benchmark keys include route and device;
new series start with this change, while older ambiguous series remain historical.
CI keeps its existing warm-up navigation and retained browser storage; summaries
label that cache mode separately from the production collector's reset storage.
Samples with different cache modes are never combined into one median.

Workers write separate benchmark fragments, merged at global teardown before
Bencher consumes `benchmark.json`. This avoids concurrent read/modify/write loss.
Retries retain the last worker's measurements. Web Vitals now exercises desktop
and mobile controls, waits for asynchronous metric delivery and fails missing
metrics instead of silently skipping NaN INP.

Run `bun run test:perf-reporting` for regression checks. `bun run test:perf`
continues to require the production build and exercises the real application.
