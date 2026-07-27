---
description: "Tanahpedia change classification (schema/data/UI) and required workflow per kind"
applyTo: "data/mysql/tanahpedia_*, web/api/src/**/tanahpedia*/**, web/api/src/resolvers/tanahpedia_*, web/bible-on-site/src/**/tanahpedia/**, web/bible-on-site/src/lib/tanahpedia/**, web/admin/**/tanahpedia*/**, devops/deploy/data-deploy/**, docs/tanahpedia/**"
---

# Tanahpedia Change Classification

Every Tanahpedia change is exactly one of three kinds. Classify it before starting work, then follow the matching workflow below.

## 1. Schema change

Adding/renaming/dropping a column, table, or relationship in a `tanahpedia_*` MySQL table.

Required workflow, in order:

1. Write the change as an **idempotent** SQL script — safe to re-run unconditionally. Plain MySQL has no `ADD COLUMN IF NOT EXISTS` (that's MariaDB-only); use the `information_schema` + `PREPARE`/`EXECUTE` idiom (see `data/mysql/tanahpedia_alter_*.sql`). Only `ALTER TABLE`, never `CREATE`/`DROP TABLE` (the production Lambda auto-injects `DROP TABLE IF EXISTS`/`DROP VIEW IF EXISTS` before any `CREATE TABLE`/`CREATE VIEW`, which would destroy data). Avoid semicolons and apostrophes inside `--` comments — the Lambda's statement splitter only tracks single-quoted strings, not comments, and either character there corrupts statement parsing.
2. Add the alter script to `devops/deploy/data-deploy/sql-files.json` in the same schema PR and run `python validate_lambda_parser.py --parse-only`. The deployer and validator share this manifest, and Data CI executes the parser check.
3. Merge and verify the schema-only Data CD reaches green **before** merging any API/website reader that references the new column. Do not rely on concurrent module releases for schema ordering.
4. Extend the authenticated **write API** to support creating/editing the new field.
5. Extend the **read API** (Rust GraphQL resolvers/DTOs in `web/api`) to retrieve the new field.
6. Populate the data locally and test end-to-end (e.g. `cargo make mysql-apply-tanahpedia-families` or the relevant `db-populator` task) to confirm schema + write API + read API work together.
7. Support the **representation** of the new field in the UI — website now, app in the future.
8. Apply production content through the authenticated write API and verify the live website — never use raw SQL against production content.

## 2. Data change

Content edits (new/changed entries, citations, relationships) with no schema change.

1. Test locally.
2. Apply to production using the authenticated **write API** — never raw SQL against production data.
3. Reread through the authenticated API and compare every writable field, then verify the rendered result on both production domains.

## 3. UI change

Website/app presentation only — no schema or data change.

1. Test locally.
2. Merge.

## Production Recovery

Use evidence before mutation. A Tanahpedia entry, entity, typed row, supporting nodes, and relationship rows are separate records; an HTTP 200 entry page proves only that the entry exists.

1. Trace the owning production read path first. Tanahpedia website pages read MySQL directly in Next.js server code; they do not use the Rust GraphQL family resolver for rendering.
2. Establish a known-good control on the same surface. Compare a known intact graph, the affected graph, the API `/health` version, and both production domains.
3. Prefer stable IDs and lossless detail reads. An empty exact-name search is not proof that a node was deleted; query a known person/entity ID and inspect the rendered server payload before concluding that data is absent.
4. Inventory the full graph before replay: focal entity/person, supporting entity/person rows, sex/name metadata, parent-child links, unions, lookup values, and every optional citation/date/alternate-group field.
5. If prerequisite nodes are missing, extend the authenticated API with an idempotent node mutation. Do not force relationship-only mutations or bypass the API with SQL.
6. Replay with stable caller-supplied IDs, reread every field, and verify that a second replay creates no duplicates.

Do not infer data loss while a schema migration or reader deployment is incomplete. Restore read compatibility first, then determine what is actually missing.

## Remote Family API Contract

- Authentication must fail closed when `TANAHPEDIA_REVISION_API_KEY` is absent, blank, or incorrect.
- Put mutations are idempotent by caller-supplied stable ID; deletes return `NOT_FOUND` for an absent row instead of silently succeeding.
- Read responses must be lossless for every writable field so a caller can read, replay, and compare without direct database access.
- Validate referenced people, lookup names, self-links, and citation lengths before writing.
- Batch lookup and related-entity reads outside row loops. Tests must model the real query sequence and must not append unused mock results that hide extra or missing queries.

## Deployment And Observability

- Data release eligibility must depend on Tanahpedia/data changes, not on an unrelated optional job such as Perushim generation. An intentionally skipped optional job must not suppress schema deployment.
- Run `validate_lambda_parser.py` against the shared production manifest in Data CI. Never assume SQL accepted by MySQL locally is compatible with the production Lambda parser.
- Family-query failures must be logged with entry/entity context before the page degrades to no tree. Never silently convert a database or schema exception into an empty family graph.
- Production smoke checks must assert known graph content, not only HTTP 200. Keep at least one known-good graph and the recovered graph in the checks.

## Family Tree UI

- Node titles remain on one line. Size the card/container for the longest supported title instead of wrapping the title.
- For multiple unequal-width spouse cards, use equal grid columns rather than centered flex distribution; connector vertices must land at equal `(index + 0.5) / count` positions.
- Horizontal buses stop at the outer connector vertices, and the focal vertical connector stops at the bus. Scope matrix and non-matrix connector rules separately so a fix for one layout cannot cross or overshoot the other.
- Prefer stretchable connector geometry (`top` plus `bottom`) and stacking-context containment over fixed heights tied to label content.
- Debug geometry with high-contrast temporary overlays, then verify the real muted colors at normal zoom. Capture tight junction screenshots and full desktop/mobile views; a zoomed or debug-color screenshot alone is not completion evidence.
