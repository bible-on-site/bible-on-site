---
description: "Tanahpedia change classification (schema/data/UI) and required workflow per kind"
applyTo: "data/mysql/tanahpedia_*, web/api/src/**/tanahpedia*/**, web/api/src/resolvers/tanahpedia_*, web/bible-on-site/src/**/tanahpedia/**, web/bible-on-site/src/lib/tanahpedia/**, web/admin/**/tanahpedia*/**, devops/deploy/data-deploy/**, docs/tanahpedia/**"
---

# Tanahpedia Change Classification

Every Tanahpedia change is exactly one of three kinds. Classify it before starting, then follow the matching workflow.

## Tanahpedia Write API

Never rediscover the write path from the UI or database schema: the canonical contract, GraphQL examples, input fields, lookup values, and readback queries are in `docs/tanahpedia/external-revision-api.md`; the implementations of record are `web/api/src/resolvers/tanahpedia_revisions_resolver.rs`, `web/api/src/resolvers/tanahpedia_family_resolver.rs`, and their DTOs/services.

### Endpoints and authentication

- Endpoints: local `http://127.0.0.1:3003/` (start from `web/api` with `cargo make run-api-dev`), production `https://api.xn--febl3a.com/`.
- Every write and family review query needs `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>`; the API fails closed when the server variable is absent, blank, or mismatched. Locally, set an ephemeral key in the API process and reuse that value in the client — never print, commit, or place a production key in a request artifact.
- On Windows/Git Bash, send non-ASCII GraphQL JSON through stdin with native `curl --data-binary @-`, never through argv.

### Mutation surfaces

- Entry title, unique name, and HTML content go through the audited two-step revision flow: `submitEntryRevision` creates a `PENDING` revision, `applyEntryRevision` applies it. Capture the revision `id` and applied `entryId`.
- **No agent-authored entry content — anywhere, including locally.** Agent-created entries carry the empty-content placeholder (`<p></p>`) plus confirmed metadata only: title, unique name, entry-entity link, person nodes, relationships, and Tanah citations. Prose is human-authored (Admin GUI / reviewed revisions).
- Person nodes and family structure use authenticated, idempotent puts — `putTanahpediaPersonNode`, `putTanahpediaEntryEntityLink`, `putTanahpediaParentChildLink`, `putTanahpediaPersonUnion` — direct structural writes, not revision rows; cleanup uses the matching narrow deletes.
- Never substitute Admin server functions, direct SQL, seed scripts, or database clients for content writes.
- Generate caller-supplied UUIDs once and keep the exact payload, so replays update the same logical rows instead of duplicating them.
- Save the operation set as JSON and run `npm run tanahpedia:apply -- <ops.json> [--endpoint <url>]` from `devops/` rather than ad-hoc scripts — the same file applies locally and replays on production after sign-off.

### Local seed = copy of production

- The canonical local dataset is a **prod copy**: `npx tsx devops/setup-dev-env.mts sync-from-prod` (AWS SSO first) restores production into `tanah-dev` and applies the safe structure/baseline upgrade. Refresh by re-syncing — never hand-repair local content.
- The demo family SQL scripts (`tanahpedia_family_*.sql`, `cargo make mysql-apply-tanahpedia-families`) are CI/edge-lab fixtures only — never the local seed, and never re-run over a prod-synced database: their fixed-UUID delete/re-insert overwrites API-authored rows.

### Required local-first sequence

1. Fetch current `master` and inspect the checked-out schema/resolvers — a mutation on another branch or worktree is not deployed.
2. Start the local API against a **prod-synced** database with an ephemeral revision key; confirm `/health` and one authenticated read before any write.
3. Query first with `tanahpediaFindEntities`, `tanahpediaFindPersons`, `tanahpediaPersonDetails`, `tanahpediaPersonUnions`, `tanahpediaPersonParentChild`; disambiguate name matches by stable IDs and entry associations.
4. Per new entry: `submitEntryRevision`, inspect the `PENDING` result, `applyEntryRevision`, capture the `entryId`.
5. Put the person node, then link the applied entry with `putTanahpediaEntryEntityLink` (input takes `entryUniqueName`, not the entry UUID).
6. Put parent-child and union rows only once every referenced person exists, preserving every optional citation, order, date, end reason, and alternate-group field.
7. Rerun the puts to prove idempotency, then reread every writable field and exact relationship count.
8. Verify the rendered local entry and its related-node links — a successful mutation or HTTP 200 is not sufficient.
9. Save the endpoint-independent operations, variables, stable IDs, and readback results for review; never the bearer token.
10. Stop before production. Only after explicit approval, replay the reviewed operations with the production key, then repeat readback and rendered verification on both production domains.

## 1. Schema change

Adding/renaming/dropping a column, table, or relationship in a `tanahpedia_*` MySQL table.

1. Write an **idempotent** SQL script, safe to re-run. MySQL has no `ADD COLUMN IF NOT EXISTS` (MariaDB-only) — use the `information_schema` + `PREPARE`/`EXECUTE` idiom (`data/mysql/tanahpedia_alter_*.sql`). `ALTER TABLE` only: the production Lambda auto-injects `DROP TABLE/VIEW IF EXISTS` before any `CREATE`, destroying data. No semicolons or apostrophes inside `--` comments — the Lambda's splitter only tracks single-quoted strings and either corrupts parsing.
2. Add the script to `devops/deploy/data-deploy/sql-files.json` in the same PR and run `python validate_lambda_parser.py --parse-only` (shared by deployer, validator, and Data CI).
3. Merge and confirm the schema-only Data CD is green **before** merging any API/website reader of the new column; never rely on concurrent module releases for ordering.
4. Extend the authenticated **write API**, then the **read API** (Rust GraphQL resolvers/DTOs in `web/api`).
5. Populate locally and test end-to-end (e.g. `cargo make mysql-apply-tanahpedia-families` or the relevant `db-populator` task).
6. Represent the field in the UI — website now, app later.
7. Apply production content through the authenticated write API and verify the live website; never raw SQL against production content.

## 2. Data change

Content edits (entries, citations, relationships) with no schema change: test locally, apply to production through the authenticated **write API** (never raw SQL), then reread through the API, compare every writable field, and verify the rendered result on both production domains.

## 3. UI change

Website/app presentation only: test locally, then merge.

## Production Recovery

Use evidence before mutation. Entry, entity, typed row, supporting nodes, and relationship rows are separate records — an HTTP 200 entry page proves only that the entry exists.

1. Trace the owning read path first: Tanahpedia pages read MySQL directly in Next.js server code, not through the GraphQL family resolver.
2. Establish a known-good control on the same surface: an intact graph, the affected graph, the API `/health` version, both production domains.
3. Prefer stable IDs and lossless reads — an empty exact-name search does not prove deletion; query a known ID and inspect the rendered server payload.
4. Follow the fixture's identity semantics: when only support nodes have fixed IDs, reuse the entry-linked focal person instead of inventing a focal ID.
5. Name matches are candidates, not identity — disambiguate with entry associations, stable IDs, typed rows, and relationship ownership.
6. Inventory the whole graph before replay: entry-entity associations, entity/person rows, supporting nodes, sex/name metadata, parent-child links, unions, lookup values, and every optional citation/date/alternate-group field. Duplicate entity badges mean duplicate entry links.
7. Missing prerequisite nodes or focal association? Extend the authenticated API with idempotent mutations — a standalone entity is not renderable, and relationship-only mutations or SQL are never the answer.
8. Create nodes and the focal association before relationships; replay with stable IDs, reread every field and row count, and confirm a second replay adds no duplicates or timestamp churn.
9. Verify family names in rendered HTML and the DOM on every production domain, then inspect family-load logs — the website may pick the first unordered entry association, so readback and HTTP 200 are not completion evidence.
10. Cleanup stays narrower than content-admin deletion: delete a duplicate entry link by ID; detach an accidental person only after transactionally proving it has no entry association, family edges, or metadata. That leaves the entity, shown in category indexes as `(אין ערך)`; delete an accidental shell in a separate transaction matching its ID, type, and display name and proving no direct entity-reference table holds it.

Do not infer data loss while a schema migration or reader deployment is incomplete — restore read compatibility first.

## Remote Family API Contract

- Authentication fails closed when `TANAHPEDIA_REVISION_API_KEY` is absent, blank, or incorrect.
- Puts are idempotent by caller-supplied stable ID; deletes return `NOT_FOUND` rather than silently succeeding.
- Recovery deletions lock and validate the exact supplied IDs, refusing orphan-person cleanup while any entry association, family edge, role, name, date, place, or other metadata remains.
- Orphan-entity cleanup is a separate step after typed-node cleanup: match `entityId`, `entityType`, `displayName`, lock the row, and refuse while any direct foreign-key reference remains. Derive the test from `tanahpedia_structure.sql` so a new entity-reference table fails coverage until the guard covers it.
- Reads are lossless for every writable field, so callers can read, replay, and compare without database access.
- Validate referenced people, lookup names, self-links, and citation lengths before writing.
- Batch lookup and related-entity reads outside row loops; tests model the real query sequence and never append unused mock results.

## Deployment And Observability

- Data release eligibility depends on Tanahpedia/data changes, not on an unrelated optional job (e.g. Perushim generation) — a skipped optional job must not suppress schema deployment.
- Run `validate_lambda_parser.py` against the shared production manifest in Data CI; locally valid MySQL is not proof of Lambda-parser compatibility.
- Log family-query failures with entry/entity context before degrading to no tree; never turn a database or schema exception into a silent empty graph.
- Production smoke checks assert known graph content, not just HTTP 200, covering a known-good graph and the recovered graph.

## Family Tree UI

- Node titles stay on one line: size the card for the longest supported title instead of wrapping.
- On narrow screens a spouse-only row with no child matrix becomes a centered vertical rail so every card is visible without nested horizontal scrolling; matrices preserving spouse/child column relationships stay on a horizontal RTL scroll owner. Never widen the document or shrink tracks until cards overlap.
- Parent cards use equal responsive columns, and the horizontal parent bus terminates at the outer card centers — measure both endpoint errors independently on narrow and wide viewports.
- For unequal-width spouse cards use equal grid columns, not centered flex distribution; connector vertices must land at `(index + 0.5) / count`.
- Horizontal buses stop at the outer connector vertices and the focal vertical connector stops at the bus. Scope matrix and non-matrix connector rules separately so one fix cannot break the other layout.
- Prefer stretchable connector geometry (`top` plus `bottom`) and stacking-context containment over fixed heights tied to label content.
- Debug with high-contrast temporary overlays, then verify the real muted colors at normal zoom, capturing both tight junction shots and full desktop/mobile views — a zoomed or debug-color screenshot is not completion evidence.
