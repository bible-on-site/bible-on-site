# Semantic Article-Content Search

Implements GitHub issue **#2039** (follow-up to #2032): a server-side semantic
search over `tanah_article` content, exposed through GraphQL as `searchArticles`
and consumed by the MAUI app under the search filter
**"תוכן מאמרים (חיבור רשת נדרש)"**. The same index is designed to be reused by
the website follow-up **#2040** — do not build a second corpus there.

## Why not MySQL FULLTEXT / native vectors

### What MySQL 8.4 offers

The deployment and CI databases run MySQL 8.4 (LTS). Relevant capabilities:

- `FULLTEXT` indexes on `InnoDB` with `MATCH ... AGAINST` in natural-language
  or boolean mode. Tokenization is whitespace/punctuation driven; there is no
  language-aware normalization for Hebrew (no niqqud stripping, no final-letter
  folding, no stemming). The default parser would treat `שמים` and `שמימ` as
  different words and niqqud-marked text as different tokens entirely.
- `ngram`/`MeCab` parsers target CJK — not useful for Hebrew.
- **No native vector type or ANN index.** MySQL 9.x added a `VECTOR` type, but
  8.4 (our LTS) does not have it, and MySQL does not ship kNN operators; even
  on 9.x you only get storage — scoring would still be a full-table cosine scan
  per query.
- No pluggable ranking: BM25-style scoring is not available; ranking is the
  opaque built-in tf-idf with no field weighting between `name`, `abstract`,
  and `content`.

### Decision

A `FULLTEXT` index alone cannot satisfy "semantic" search: it cannot fold
Hebrew final letters, cannot strip niqqud/teamim, cannot do fuzzy or
synonym-adjacent matching, and cannot weigh title vs. body terms. A hosted
embedding service (OpenAI/Cohere-style) was rejected for cost, privacy,
latency-budget, and ops complexity — the corpus is ~hundreds of rabbinic
articles, not millions of documents.

The chosen architecture is a **derived, rebuildable index owned by the API**:

- Hebrew-aware **normalization** (see below) — the piece FULLTEXT lacks.
- A **sparse inverted index** with BM25-style saturation for lexical quality.
- An **LSA-style dense model** — truncated randomized SVD over the tf-idf
  term×document matrix — for semantic approximation: terms that co-occur across
  the corpus land in the same latent dimensions, so a query matches documents
  that discuss the topic even when the exact words differ. New/changed articles
  are folded into the existing basis; the basis is periodically retrained.

This is deliberately a *lower-cost semantic approximation*, not transformer
embeddings. See [Limitations](#limitations).

## Pipeline

```
tanah_article (authoritative)
      │  name / abstract / content (HTML) / distributable gate
      ▼
 text.rs: strip_html → normalize → tokenize → term_frequencies
      │  weighted counts (name ×w, abstract ×w, content ×1)
      ▼
 lsa.rs:  build_vocabulary (df-filtered) → tf-idf sparse vectors
      │  → randomized SVD basis (dims ≤ 64) → per-doc unit embeddings
      ▼
 store.rs: article_search_state (model blob + epoch)
           article_search_doc   (vector, terms, content hash)
           article_search_queue (pending ids, attempts, last_error)
```

Only **normalized term statistics and embeddings** are persisted. Article HTML
never leaves `tanah_article`; excerpts are recomputed at query time from the
authoritative row.

### Normalization (`article_search/text.rs`)

1. `strip_html` — drops `<script>`/`<style>` bodies entirely, treats block tags
   as word boundaries, decodes named/numeric entities, survives truncated tags.
2. `normalize` — strips niqqud (U+0591–05C7) and teamim, normalizes quote
   punctuation, **folds final letters** (ם→מ, ן→נ, ף→פ, ץ→צ, ך→כ), lowercases.
3. `tokenize` — splits on non-word characters; keeps Hebrew, Latin, digits.
4. Query-side expansion: exact term → prefix completions (≤24, weight 0.85) →
   bounded edit-distance fuzzy matches (≤12, weight 0.6) when nothing else hit.

### Ranking

`score = 0.65 · semantic + 0.35 · lexical`, where

- `semantic` = cosine between the query embedding (folded into the LSA basis)
  and each document's unit embedding;
- `lexical` = BM25-style term score `Σ q_w · idf · tf(k1+1) / (tf + k1(1−b+b·len/avg))`,
  saturated into [0, 1) — rewards exact wording and term rarity;
- hits below `MIN_SCORE = 0.15` are dropped; ordering is `score` desc, then
  `article_id` asc for stability. `total` reports the pre-pagination count.

`semanticScore` and `lexicalScore` are exposed in the GraphQL hit for
diagnostics and tuning.

## Write lifecycle

All three derived tables are created idempotently at API boot
(`store::ensure_schema`).

| Event | Path |
|-------|------|
| article **created/updated/deleted** | the admin transaction enqueues the id into `article_search_queue` in the *same* transaction (`web/admin/src/server/articles.ts`) — a queue failure aborts the write |
| worker tick (every 15 s) | drains ≤256 queue ids; fetches the article (`distributable = TRUE` only) and upserts `article_search_doc` under the current model; `None` result (deleted or made non-distributable) purges the doc row |
| sync failure | `attempts` + `last_error` are recorded; rows past `MAX_ATTEMPTS = 20` are skipped by the regular drain — a poison row can never wedge the worker — and retried only after the reconcile sweep re-enqueues them |
| reconcile sweep (every ~10 min) | diffs server-side `MD5` content hashes between `tanah_article` and `article_search_doc`, re-enqueues drifted/missing ids, re-folds stale-epoch docs, and deletes docs whose source vanished or became non-distributable |
| drift ≥ 32 docs or ≥ 8 % of corpus | full **retrain** under `GET_LOCK('article_search_retrain', 0)` so concurrent API instances never train in parallel; docs are persisted first, then `model_epoch` bumps, so readers never load a half-written snapshot |

The enqueue write is idempotent (`ON DUPLICATE KEY UPDATE` resets the attempt
counter) so writers may safely re-enqueue, and reconcile self-heals any missed
write path.

### Deletion / visibility

- `DELETE` → enqueue id → worker fetch returns `None` → doc purged + dequeued.
- `distributable` flipped FALSE → same path (fetch treats it as absent);
  reconcile's orphan sweep also covers `a.distributable = FALSE`.
- `distributable` flipped TRUE → reconcile sweep detects the missing hash.
- `fetch_hit_rows` re-checks `a.distributable = TRUE` at query time, so a row
  can never leak through a race between write and index sync.

### Rebuild / backfill

```bash
cd web/api
cargo make rebuild-article-search        # honors PROFILE like run-api-*
# or: REBUILD_ARTICLE_SEARCH=1 cargo run
```

One-shot mode: connects, ensures schema, takes the advisory lock, retrains,
persists docs + model, bumps `model_epoch`, releases the lock. Running API
instances notice the epoch change via `state_probe` and hot-reload their
in-memory snapshot — **no restart or downtime needed**. Running it while
another instance retrains exits with an error instead of corrupting state.

## GraphQL API

```graphql
query SearchArticles($phrase: String!, $limit: Int, $offset: Int) {
  searchArticles(phrase: $phrase, limit: $limit, offset: $offset) {
    total
    hits { articleId name authorName authorId perekId source
           excerpt score semanticScore lexicalScore }
  }
}
```

- `phrase` ≤ 256 chars; `limit` 1–50 (default 20); `offset` 0–1000.
- Errors are GraphQL `BAD_REQUEST`/`INTERNAL_SERVER_ERROR` with extension
  `code`; a stale-snapshot probe failure degrades to serving the warm snapshot
  rather than failing the request.
- The search worker runs detached (`tokio::spawn`) — a worker failure logs a
  warning and never takes down request serving.

## Performance envelope

Corpus is small (~hundreds of distributable articles), so the design favors
simplicity:

| Concern | Approach / measured order |
|---------|---------------------------|
| Query latency | all scoring is in-memory over `docs × dims` (dims ≤ 64) — sub-millisecond per doc; `fetch_hit_rows` fetches only the requested page |
| Memory | `docs × dims × 4 B` for vectors + postings map — a few MB at 10⁴ docs |
| Storage | `article_search_doc` ≈ `dims×4 + terms` bytes per article (~1–2 KB); model blob is `vocab × dims × 1 B` quantized + scales |
| Indexing | incremental fold-in per write; full retrain is O(docs × vocab) — seconds on the current corpus |
| Rebuild | `cargo make rebuild-article-search`, lock-guarded, online |

Measure again with `EXPLAIN`/timing if the corpus grows past ~10⁵ docs —
beyond that a purpose-built vector index (pgvector, Meilisearch, or a hosted
embeddings service) should be re-evaluated.

## Limitations

- **Approximation, not transformer semantics.** LSA captures co-occurrence
  ("אלהים" ≈ "קב\"ה" when they share contexts) but not word order, negation,
  or compositional meaning. Embeddings are folded in incrementally — new
  vocabulary only enters the basis at the next retrain.
- **Hebrew morphology is shallow.** Final letters fold and niqqud strips, but
  there is no stemming (`כתב`/`כתיבה` remain distinct), no gershayim-aware
  tokenization beyond punctuation normalization, and prefixes (`ב`, `ל`, `ה`)
  are not segmented — prefix expansion and fuzzy matching compensate partially.
- **Corpus drift.** Queue attempts cap at 20; a permanently broken row surfaces
  only via `last_error`/reconcile, so monitor `article_search_queue` when
  debugging.
- **Single-corpus assumptions.** Scoring constants (MIN_SCORE, weights) were
  tuned for the current corpus size; a much larger corpus will want
  recalibration and possibly `dims` > 64.
- **Operational.** The worker polls every 15 s — a fresh write can take up to
  ~15 s to appear in results (plus up to 10 min if the enqueue was lost and
  only reconcile catches it).

## Reuse by the website (#2040)

#2040 should call `searchArticles` on this API — the derived tables, Hebrew
normalization, ranking, incremental sync, and rebuild tooling are shared.
There is nothing website-specific to re-index; only a UI/route layer is needed.
