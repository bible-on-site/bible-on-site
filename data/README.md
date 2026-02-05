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

## 929 Study Program Cycles

The `tanah-view` pipeline generates Hebrew date mappings and star rise times for the 929 Perakim study program.

Cycle data is generated at runtime during the aggregation pipeline, eliminating the need for a separate generation step.

Each perek includes:
- `date`: Array of 4 Hebrew dates (one per cycle) in YYYYMMDD format
- `star_rise`: Array of 4 times (one per cycle) in HH:MM format (astronomical dusk in Jerusalem)

## MySQL Database

The `mysql/db-populator` crate populates a MySQL database with Tanah structure and test data.

### Development database (tanah-dev)

The development database is named **tanah-dev**. It is used by the website, admin, and data tooling when running locally. `DB_URL` in `data/.dev.env` (and in `web/bible-on-site/.dev.env`, `web/admin/.dev.env`) points to `tanah-dev`.

### Default populate flow (dev)

To create and populate the dev database from structure and test data:

```bash
cargo make mysql-populate-dev
```

This uses `DB_URL` from `data/.dev.env` and targets the `tanah-dev` database.

### Populate Database (generic)

```bash
# Set DB_URL in .test.env or pass directly
cargo make mysql-populate

# Dev database (tanah-dev) - uses data/.dev.env
cargo make mysql-populate-dev

# Data only (skip structure recreation)
cargo make mysql-populate-data-only
```

The `DB_URL` environment variable should be in the format: `mysql://user:pass@host:port/database`

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
- `S3_ENDPOINT` – e.g. `http://localhost:4566` for LocalStack