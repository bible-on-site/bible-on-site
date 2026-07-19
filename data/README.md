# Data Processing (v0.1.3)

This directory contains data processing tools and pipelines for the Bible On Site project.

## Prerequisites

- Rust (latest stable)
- cargo-make: `cargo install cargo-make`
- MongoDB (for Sefaria data processing)

## Quick Start

### 1. Setup Environment

```bash
cargo make sefaria-setup
```

This will:
- Check MongoDB installation
- Create `.env` from `.env.example`

### 2. Download Sefaria Data

See [sefaria/retrieval/README.md](sefaria/retrieval/README.md) for instructions.

### 3. Populate MongoDB

```bash
cargo make sefaria-populate
```

### 4. Generate Tanah View

```bash
# Generate JSON output
cargo make generate-tanah-view-json

# Generate SQLite output
cargo make generate-tanah-view-sqlite
```

Outputs will be written to `sefaria/.outputs/`.

## Available Tasks

| Task | Description |
|------|-------------|
| `build` | Build all data processing tools |
| `clean` | Clean build artifacts |
| `lint` | Run clippy linter |
| `fmt` | Format code |
| `sefaria-setup` | Check MongoDB and setup environment |
| `sefaria-populate` | Import Sefaria dump into MongoDB |
| `generate-tanah-view-json` | Generate Tanah view as JSON |
| `generate-tanah-view-sqlite` | Generate Tanah view as SQLite |
| `mysql-populate` | Populate MySQL database with structure and test data |
| `mysql-populate-data-only` | Populate MySQL database with test data only |
| `mysql-upgrade-tanahpedia-structure` | Safely create/upgrade Tanahpedia structure without dropping existing content |
| `mysql-seed-tanahpedia-baseline` | Safely seed Tanahpedia lookup/baseline rows without overwriting content |
| `mysql-upgrade-tanahpedia-dev` | Safe Tanahpedia structure + baseline seed for `tanah-dev` |
| `mysql-apply-tanahpedia-families` | תנכפדיה בלבד: שמשון (אם קיים) + יעקב — בלי populate מלא |
| `mysql-apply-tanahpedia-edge-lab` | 38 ערכי דמו למקרי קצה בעץ משפחה (מעבדה; UUIDs קבועים) |

## 929 Study Program Cycles

The `tanah-view` pipeline generates Hebrew date mappings and star rise times for the 929 Perakim study program.

Cycle data is generated at runtime during the aggregation pipeline, eliminating the need for a separate generation step.

Each perek includes:
- `date`: Array of 4 Hebrew dates (one per cycle) in YYYYMMDD format
- `star_rise`: Array of 4 times (one per cycle) in HH:MM format (astronomical dusk in Jerusalem)

## MySQL Database

The `mysql/db-populator` crate populates a MySQL database with Tanah structure and test data.

The db-populator has two Tanahpedia modes:

- **Destructive rebuild** (`mysql-populate*`): recreates Tanah/Tanahpedia tables and seeds local/CI data. Use for fresh dev/test databases only.
- **Safe upgrade/seed** (`mysql-upgrade-tanahpedia-*`, `mysql-seed-tanahpedia-baseline`): creates missing Tanahpedia tables, applies idempotent structure upgrades, and inserts lookup/baseline rows without dropping or replacing content. Use for production-like databases and after syncing remote content locally.

The safe structure path reuses `tanahpedia_structure.sql` as the source schema, but the Rust populator removes `DROP TABLE IF EXISTS` statements and converts `CREATE TABLE` to `CREATE TABLE IF NOT EXISTS` at runtime. Future structural changes should be added as idempotent upgrade scripts, not by relying on destructive rebuilds.

The db-populator runs `tanahpedia_family_shimshon_data.sql` after Tanahpedia seeds whenever the **target** database has a `tanahpedia_person` row for entity name **שמשון** (from `tanahpedia_legacy_migration.sql` or from prod sync). This is **independent** of whether the legacy migration ran (e.g. when `PROD_DB_URL` is set and prod already has Tanahpedia). The script is idempotent for its fixed demo UUIDs. It needs `source_citation` columns on `tanahpedia_person_union` / `tanahpedia_person_parent_child`; the db-populator adds those columns idempotently after checking `information_schema` in safe/full Tanahpedia paths.

Before family demo SQL, the populator applies `tanahpedia_incremental_lookups.sql` (`INSERT IGNORE` for new lookup rows such as `FORBIDDEN_WITH_GENTILE`) so older DBs do not fail FK checks when running `cargo make mysql-apply-tanahpedia-families` only.

After the יעקב script, `tanahpedia_place_eretz_yisrael_data.sql` adds the `eretz-yisrael` place entry (coordinates + category homepage `MAP` for `/tanahpedia/place`). Re-run `cargo make mysql-apply-tanahpedia-families` or full populate to apply it on an existing DB.

After that, when `tanahpedia_family_jacob_data.sql` is present, full populate applies the **יעקב** demo (Tanahpedia entry `יעקב`, parents, four wives including בלהה וזלפה as full wives per הכתב והקבלה בראשית לב כג, children, and brother עשו) only when the entry is missing. `mysql-apply-tanahpedia-families` forces the family/place demo scripts. The demo scripts use fixed UUIDs (`e200…` / `p200…` / `ea200…` — each script deletes only its own fixed demo rows before re-insert), so do not use the forced demo task as the normal content editing path after production content is edited remotely.

**יעקב** does **not** come from `tanahpedia_legacy_migration.sql`; if the DB was filled without running the full data phase (e.g. prod sync only), run the family scripts explicitly (see below).

### Development database (tanah-dev)

The development database is named **tanah-dev**. It is used by the website, admin, and data tooling when running locally. `DB_URL` in `data/.dev.env` (and in `web/bible-on-site/.dev.env`, `web/admin/.dev.env`) points to `tanah-dev`.

### Default populate flow (dev)

To create and populate the **tanah-dev** database (structure, sefarim/perakim, perushim, tanahpedia seeds — **without** bundled demo authors/articles from `tanah_test_data.sql`):

```bash
cargo make mysql-populate-dev
```

This uses `DB_URL` from `data/.dev.env`. Use real articles via [sync from production](#sync-from-production-optional), or load the full SQL demo seed when needed:

```bash
cargo make mysql-populate-dev-with-test-articles
```

### Populate Database (generic)

```bash
# Set DB_URL in .test.env or pass directly
cargo make mysql-populate

# Dev database (tanah-dev) - uses data/.dev.env
cargo make mysql-populate-dev

# Data only (skip structure recreation)
cargo make mysql-populate-data-only

# תנכפדיה — מבנה בטוח + זרעי lookup בלי מחיקת תוכן
cargo make mysql-upgrade-tanahpedia-structure
cargo make mysql-seed-tanahpedia-baseline

# תנכפדיה — אותו safe upgrade עבור tanah-dev
cargo make mysql-upgrade-tanahpedia-dev

# תנכפדיה — רק דמו משפחות (שמשון אם יש איש, אז יעקב); לא דורס ישויות אחרות
cargo make mysql-apply-tanahpedia-families

# מעבדת מקרי קצה לעץ משפחה (אחרי populate/seed); ראו docs/plans/tanahpedia-family-edge-lab.md
cargo make mysql-apply-tanahpedia-edge-lab
```

The `DB_URL` environment variable should be in the format: `mysql://user:pass@host:port/database`

**Production / DB שכבר מלא:** אל תריצו populate מלא. הריצו את המסלול הבטוח עם `DB_URL` ליעד:

```bash
cargo make mysql-upgrade-tanahpedia-structure
cargo make mysql-seed-tanahpedia-baseline
```

אם צריך להכניס את דמו המשפחות הראשוני בלבד, אפשר להריץ `cargo make mysql-apply-tanahpedia-families`; אחרי שתוכן נערך מרחוק דרך admin/API, לא להשתמש במשימת הדמו כנתיב עריכה רגיל.

### Tanahpedia content direction

Tanahpedia SQL files should remain responsible for schema, stable lookup rows, bootstrap seed, and local/demo fixtures. Normal content expansion should move through the admin Tanahpedia edit API, so production content can evolve remotely. For local development against remote content, sync the remote DB into `tanah-dev`, then run the safe structure/baseline upgrade:

```bash
cargo make mysql-upgrade-tanahpedia-dev
```

### Sync from production (optional)

Pull production data (database + optional S3) into your local `tanah-dev` environment:

```bash
# Login to AWS SSO first
AWS_PROFILE=AdministratorAccess-250598594267 aws sso login

# Sync production DB to local tanah-dev
AWS_PROFILE=AdministratorAccess-250598594267 npx tsx devops/setup-dev-env.mts sync-from-prod
```

Preview without making changes:

```bash
AWS_PROFILE=AdministratorAccess-250598594267 npx tsx devops/setup-dev-env.mts sync-from-prod --dry-run
```

**What it does:**

1. Fetches production DB credentials from AWS SSM (`/bible-on-site-tanah-db-url`)
2. Fetches RDS security group ID by name (`tanah-rds-sg`)
3. Temporarily authorizes your public IP on the RDS security group
4. Runs `mysqldump` from production and restores into local `tanah-dev`
5. **Migrates article content**: replaces S3 references from `bible-on-site-assets` → `bible-on-site-assets-dev`
6. Optionally syncs S3 assets from prod to dev bucket
7. Revokes the security group ingress rule

**S3 bucket naming convention:**

| Environment | Bucket Name |
|-------------|-------------|
| Production | `bible-on-site-assets` |
| Development | `bible-on-site-assets-dev` |
| Test | `bible-on-site-assets-test` |

**Defaults (hardcoded):**

| Setting | Value |
|---------|-------|
| AWS Region | `il-central-1` |
| SSM Parameter | `/bible-on-site-tanah-db-url` |
| RDS Security Group | `tanah-rds-sg` |
| Prod S3 Bucket | `bible-on-site-assets` |
| Dev S3 Bucket | `bible-on-site-assets-dev` |

**Optional overrides** (environment variables):

- `PROD_DB_URL` – Override production DB URL (skips SSM fetch)
- `PROD_RDS_SG_ID` – Override security group ID (skips describe-security-groups)
- `PROD_S3_BUCKET`, `S3_BUCKET` – Override S3 bucket names
- `S3_ENDPOINT` – e.g. `http://localhost:4566` for MinIO