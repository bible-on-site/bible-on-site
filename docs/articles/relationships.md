# Article Relationships

Every semantic relationship an article can hold, its cardinality, owning
workflow, validation and lifecycle — issue #3102. The single source of truth
is `web/shared/article-relationships/registry.json`; the Rust API embeds it
(`articleRelationshipCapabilities`) and the admin renders it verbatim, so the
two consumers can never disagree about the catalogue. The LLM draft/approval
pipeline (#3103) programs against this contract — it proposes relationship
changes as evidence-backed drafts and never writes production rows directly.

## Relationship matrix

| Key | Label | Target | Cardinality | Link metadata | Owner | Permission | Operations | Status |
| --- | ----- | ------ | ----------- | ------------- | ----- | ---------- | ---------- | ------ |
| `primaryPerek` | פרק ראשי | perek | exactly-one | — | article | `ARTICLE_API_KEY` | read, replace | supported |
| `author` | מחבר | author | exactly-one | — | article | `ARTICLE_API_KEY` | read, replace | supported |
| `coveringSources` | כיסוי פסוקים מאומת | `{perekId,pasuk}` | many | `coverageVerified` | article | `ARTICLE_API_KEY` | read, replace, clear | supported |
| `dedicationAssignments` | הקדשות | dedication | many | `expiresAt` | dedication | `DEDICATION_API_KEY` | read, add, replace, remove | supported |
| `mentionAnnotations` | אנוטציות תנכפדיה | tanahpedia entity name | many | span, surface, intendedName, entityType, disambiguation, confidence, acceptance, contentHash, modelRevision | annotation-pipeline | — (no admin/API write) | read | supported |
| `recurringHebrewDate` | תאריך עברי חוזר | Hebrew month/day | many | — | article | `ARTICLE_API_KEY` | — | pending-schema (#3098) |
| `moadim` | מועדים | moed | many | — | article | `ARTICLE_API_KEY` | — | pending-schema (#3101) |

The matrix describes the relationship contract, not eligibility for AI
suggestions. An article's author is explicitly selected during upload and is
authoritative. The LLM/heuristic linking pipeline must never infer, assign or
replace that attribution, even with a byline or human approval. It rejects
author approvals and blocks application of legacy author proposals; explicit
upload and manual editor/API attribution workflows remain available. See
[author attribution](./link-proposals.md#author-attribution).

## Write contracts

- **`updateArticleRelationships`** (API, `ARTICLE_API_KEY` bearer):
  `perekId`/`authorId` replace the required single-valued fields (existing
  canonical targets; they cannot be cleared). `coveringSources` replaces the
  verified-coverage set: integer coordinates, `pasuk >= 1`, within the
  canonical `pasuk_count`, no duplicates; `coverageVerified: true` requires
  at least one row. Omitted fields keep their stored state; an explicit
  `coveringSources: []` clears the set and marks coverage unknown.
- **Dedication assignments** are managed only through the dedication
  workflow (`createDedication`/`updateDedication`/`deleteDedication`, or the
  admin's dedications page) with a `kind: ARTICLE` target — the dedication
  aggregate owns its full target set, and assignment-level `expiresAt` is
  distinct from the whole-dedication expiry.
- **Mention annotations** are pipeline-owned: rows are produced by the
  `data/` annotation pipeline and upserted by
  `devops/import-tanahpedia-mentions.mts`. There is deliberately no admin/API
  write path — a parallel CRUD surface would compete with the pipeline's
  dedupe and content-hash lifecycle.
- **Pending-schema relationships** (#3098 recurring Hebrew dates, #3101
  moadim) are surfaced as `pending-schema` entries. When their tables land
  on master they integrate through this same contract — never through a
  fabricated table or a competing mutation.

## Freshness and concurrency

`updateArticleRelationships` runs in one transaction under
`SELECT ... FOR UPDATE` on the article row and accepts two optional
freshness tokens:

- `expectedContentHash` — lowercase hex of the generated
  `tanah_article.content_hash` (covers name/abstract/content/perek/author);
  returned by `articleRelationships.contentHash`.
- `expectedCoveringSources` — the exact `{perekId,pasuk}` set the caller
  read (order-insensitive).

A mismatch rejects the write before any change, so a stale client can never
overwrite an unseen edit. The result carries `previous` (the pre-write
state) as the supported undo record.

## Invalidation

Every committed relationship write enqueues a website revalidation entity
change carrying the old ∪ new identities — a perek/author move expires both
the old and new listing surfaces, a coverage replace expires the destroyed
and live covering spans, and a dedication target change expires both sides'
article assignments. Article content writes enqueue the article into the
derived `article_search_queue` inside the same transaction; that queue is a
side effect of writes, not a content relationship.

## Excluded internal/derived tables

`tanah_article_metric*` (computed reading metrics), `article_search_queue`
and the daily-bulletin/web-push delivery tables reference articles but are
transport or derived state — the registry lists them under
`internalDerivedTables` and they are never user-editable relationships.

## Admin surface

The article edit page (`/articles/$id`) renders
`ArticleRelationshipsPanel`: one section per registry entry — the
article-owned fields point at the form/editor that manages them, dedication
assignments link to the dedications workflow, mention annotations render
read-only with their staleness flag, and pending-schema entries name their
owning issue. `getArticleRelationshipDetails` (server fn) aggregates the
non-form links with the same SQL and semantics as the API projection.

Relationship changes proposed by the LLM/heuristic linking pipeline are
drafted, reviewed and applied through this contract — see
[link-proposals.md](./link-proposals.md).
