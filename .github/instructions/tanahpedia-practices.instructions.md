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
2. Apply to production using the **write API** (`submitEntryRevision`/`applyEntryRevision`) — never raw SQL against production data.

## 3. UI change

Website/app presentation only — no schema or data change.

1. Test locally.
2. Merge.
