# Dedications contract (#2731)

Dedications (הקדשות) attach an honouring subject (`מרדכי בן זאב`, ...) plus
purpose types (`לע"נ`, `רפואה שלימה`, ...) to a scope of reading content. The
legacy schema kept `tanah_dedication`, `tanah_dedication_type`,
`tanah_dedication_dedication_type`, `tanah_article_dedication` and
`tanah_perek_dedication`; #2731 preserves all of them and adds the expanded
scopes and expiry.

## Schema

Defined in `data/mysql/tanah_dedication_upgrade.sql` (registered in
`devops/deploy/data-deploy/sql-files.json`, applied by the Rust db-populator,
and mirrored in `data/mysql/tanah_dynamic_structure.sql`). All DDL is built
inside `CONCAT(...)` strings because the data-deploy Lambda rewrites literal
`CREATE TABLE` into destructive drop/recreate operations.

| Table                              | Scope                                  | Key                              |
| ---------------------------------- | -------------------------------------- | -------------------------------- |
| `tanah_dedication`                 | the dedication itself (`subject`)      | `id`                             |
| `tanah_dedication_type`            | purpose catalogue                      | `id`                             |
| `tanah_dedication_dedication_type` | dedication ↔ purposes (many-to-many)   | `(dedication_id, dedication_type_id)` |
| `tanah_perek_dedication`           | inclusive perek-id range               | `(perek_id_low, perek_id_high, dedication_id)` |
| `tanah_article_dedication`         | one article                            | `(article_id, dedication_id)`    |
| `tanah_sefer_dedication`           | whole sefer (incl. its additionals)    | `(sefer_id, dedication_id)`      |
| `tanah_helek_dedication`           | whole helek (1 תורה, 2 נביאים, 3 כתובים) | `(helek_id, dedication_id)`    |
| `tanah_parasha_dedication`         | weekly parasha unit (joined readings share one id) | `(parasha_id, dedication_id)` |
| `tanahpedia_entry_dedication`      | one Tanahpedia entry by id             | `(entry_id, dedication_id)`      |
| `tanah_masora_dedication`          | the whole מסורה על הפרק feature        | `(dedication_id)`                |

Every table except `tanah_dedication_type` carries `expires_at DATETIME NULL`.

## Expiry semantics

- `expires_at` is a `DATETIME` holding a **UTC wall-clock** instant (no
  session-timezone conversion); readers compare it with `UTC_TIMESTAMP()`.
- An assignment is publicly visible while **every** applicable `expires_at`
  is `NULL` or strictly in the future. The expiry instant itself is the first
  hidden moment (`expires_at <= now` ⇒ hidden).
- `tanah_dedication.expires_at` retires the whole dedication regardless of
  per-assignment expiry. `NULL` means ongoing; no end date is fabricated.
- Link-row `expires_at` retires one assignment while other assignments of the
  same dedication stay active.
- Admin reads see all rows (including expired); public reads filter.

## Identity and referential rules

- One dedication may hold many purposes (existing many-to-many) and many
  targets of different kinds simultaneously.
- Multiple dedications may point at the same target.
- `sefer_id`, `helek_id`, `parasha_id`, `perek_id_low/high` deliberately carry
  **no FK**: deploys recreate `tanah_sefer`/`tanah_helek`/`tanah_perek`, and a
  cascade would silently delete still-valid assignments. The write path
  validates ids and `perek_id_low <= perek_id_high` against the canonical
  tables instead.
- `article_id`, `entry_id`, `dedication_id` links get real `ON DELETE CASCADE`
  FKs: articles and entries persist across deploys, and removing a dedication
  removes its assignments.
- `parasha_id` is the shared parasha-division unit id
  (`web/bible-on-site/src/data/parasha/parasha-units.ts` `unitId`), so joined
  readings (e.g. ויקהל-פקודי) dedicate once.
- The masora scope is one row per dedication — it names the whole feature, not
  internal פתוחה/סתומה units — and renders once per reading context across all
  masora units.

## Resolution

One shared applicability resolver per surface maps a reading context to its
active dedications:

- perek page → direct/range + sefer + helek ancestors of that perek
- sefer page → sefer + helek ancestors
- helek/bookshelf page → helek
- parasha page → parasha unit id (joined portions share the unit's id)
- Tanahpedia entry page → entry id (never inferred from prose mentions)
- masora page → the feature-scope row, once per context
- article page → article id

Resolution batches the lookup (no per-pasuk or per-book-row fan-out),
deduplicates by `dedication.id`, and exposes scope so the UI can label
"הקדשה לספר תהילים" versus a per-perek assignment.
