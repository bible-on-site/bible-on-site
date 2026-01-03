# Data Processing

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

### Populate Database

```bash
# Set DB_URL in .test.env or pass directly
cargo make mysql-populate

# Data only (skip structure recreation)
cargo make mysql-populate-data-only
```

The `DB_URL` environment variable should be in the format: `mysql://user:pass@host:port/database`