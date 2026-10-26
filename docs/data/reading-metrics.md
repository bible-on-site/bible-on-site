# Shared reading-metrics contract (#2607)

A shared, database-backed description of _how much reading_ a content unit
carries — word counts, estimated reading time, and word-positioned blocks
for scroll/progress mapping. Metrics are **persisted in MySQL** so the
website and the native app show identical numbers; no client re-counts
content at request time.

## Counting policy

- Hebrew silent-reading baseline: **220 words per minute**
  (`READING_WORDS_PER_MINUTE` in `web/shared/reading-metrics/policy.ts`).
- `estimated_seconds = ceil(word_count * 60 / 220)`.
- `word_count = NULL` → metric unknown / not computed; **omit the UI badge**.
- `word_count = 0` → verified empty content; shows a zero estimate.
- Hebrew-aware counting (`web/shared/reading-metrics/`): HTML is converted
  to plain text first — markup, entities, scripts/styles, and
  non-counted decoration are stripped; words split on Hebrew-aware
  whitespace/word boundaries. The same counters feed admin writes and the
  backfill, so stored values share one definition.
- `calc_version` pins the counting algorithm version. `source_hash`
  (SHA-256 over the canonical counted text) lets readers/backfill detect
  content drift without recounting.

## Tables

Defined in `data/mysql/tanah_reading_metrics_upgrade.sql` (registered in
`devops/deploy/data-deploy/sql-files.json` and applied by the Rust
db-populator after the base tables exist). The script creates tables via
dynamic `CONCAT(...)` SQL because the data-deploy Lambda rewrites literal
`CREATE TABLE` into destructive drop/recreate operations.

| Table                           | Granularity                            | Key                      |
| ------------------------------- | -------------------------------------- | ------------------------ |
| `tanah_perek_metric`            | whole perek                            | `perek_id`               |
| `tanah_perek_pasuk_metric`      | one row per pasuk                      | `(perek_id, pasuk)`      |
| `tanah_article_metric`          | whole article                          | `article_id`             |
| `tanah_article_metric_block`    | ordered readable HTML blocks           | `(article_id, block_idx)`|
| `tanah_note_metric`             | single perush note                     | `(perush_id, perek_id, pasuk, note_idx)` |
| `tanah_perush_metric`           | perush within a perek                  | `(perush_id, perek_id)`  |
| `tanahpedia_entry_metric`       | whole Tanahpedia entry                 | `entry_id`               |
| `tanahpedia_entry_metric_block` | ordered readable HTML blocks           | `(entry_id, block_idx)`  |

Aggregate rows carry `word_count`, `estimated_seconds`,
`words_per_minute`, `calc_version`, `source_hash`, `computed_at`.
Block/pasuk rows carry ordered `word_count` plus `cumulative_words`
— the word-position axis GUIs use to convert scroll offsets into reading
progress.

Foreign-key cascades exist only where the referenced table survives data
deploys (articles, Tanahpedia entries). Perek/perush tables are recreated
by deploys, so their metric tables intentionally omit FKs; staleness is
detected via `source_hash`/`calc_version` and repaired by the backfill.
Perush note deletions leave no FK trail either, so the perush backfill
pass also prunes `tanah_note_metric`/`tanah_perush_metric` rows whose
source notes (or whole groups) no longer exist.

## Writers

- **Admin write path** (`web/admin/src/server/reading-metrics.ts`):
  article create/update and Tanahpedia entry create/revision-apply/
  restore recompute metrics inside the same transaction — the content
  change and its metric commit atomically. Missing-schema errors degrade
  (pre-upgrade databases); unrelated failures abort the write.
- **Backfill** (`web/admin/scripts/backfill-reading-metrics.mts`,
  `bun run metrics:backfill` in `web/admin`): batches all kinds
  (`perek,article,perush,entry`), skips rows whose stored
  `source_hash`/`calc_version` are still current, `--force` recounts.
  Kinds that wrote rows then POST the website `/api/revalidate`
  invalidations (tag `reading-metrics` for perek, `articles`,
  `perushim`, path `/pedia/[slug]` for entries) when
  `VITE_WEBSITE_URL` + `REVALIDATE_SECRET` are configured — without it,
  prerendered pages keep serving metric-less output indefinitely.

## Readers

- **Website** (`web/bible-on-site/src/lib/reading-metrics/`):
  `getPerekMetric`, `getArticleMetrics`, `getPerushMetricsByPerekId`,
  `getPerushMetric`, `getEntryMetric`. Missing-table/column errors
  (ER_NO_SUCH_TABLE 1146, ER_BAD_FIELD_ERROR 1054) degrade to "metric
  unknown" so the website can ship before the data deploy. Consumers wrap
  the reads in `metricOrFallback`, so any other metric-query failure logs
  and renders the page badge-less instead of hiding the decorated
  content. `ReadingTime` renders the badge; `format.ts` formats Hebrew
  labels; JSON-LD adds `timeRequired` + `wordCount` only when a stored
  metric exists.
- **Native app / GraphQL**: not yet consumed — the app needs DTO fields
  for `wordCount`/`estimatedSeconds` (and block lists for progress) on
  the GraphQL API. Tracked under the remainder of #2607.

## Progress semantics

Blocks are in reading order; `cumulative_words` is the count of
counted words _through the end of that block_. A GUI maps the reader's
position to a block, then reports `cumulative / aggregate.word_count`.
Pesukim are the perek's block unit; readable HTML blocks are the unit for
articles and entries; perushim expose both note-level
(`tanah_note_metric`) and aggregate rows.
