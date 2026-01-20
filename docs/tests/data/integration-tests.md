# Data Integration Tests

This document describes the setup for running data integration tests locally and in CI.

## Overview

Data integration tests verify the MongoDB aggregation pipelines used to process Sefaria data. These tests require MongoDB with the Sefaria dump pre-loaded.

## Local Development

### Prerequisites

1. **MongoDB** - Install MongoDB Community Server
2. **MongoDB Tools** - Install MongoDB Database Tools (includes `mongorestore`)

### Setup

1. Download the Sefaria dump:

   ```bash
   mkdir -p data/sefaria/.raw
   cd data/sefaria/.raw
   curl -L https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz -o dump_small.tar.gz
   tar -xzf dump_small.tar.gz
   ```

2. Start MongoDB and import the dump:

   ```bash
   cd data
   cargo make sefaria-setup   # Check MongoDB installation
   cargo make sefaria-populate # Import the dump
   ```

3. Run integration tests:

   ```bash
   cd data
   cargo test --features integration
   # Or with cargo-make:
   cargo make test-integration
   ```

## CI Integration

In CI, a Docker image is used that contains MongoDB with the Sefaria dump pre-loaded. This avoids downloading and importing the dump on every CI run.

### Docker Image

The Docker image is defined in `data/sefaria/mongodb-docker/`:

- `Dockerfile` - Builds MongoDB with Sefaria dump pre-loaded
- `init-mongo.sh` - Initialization script for importing the dump
- `README.md` - Docker-specific documentation

### CI Workflow

The CI workflow (`.github/workflows/ci.yml`):

1. **build_sefaria_mongo_docker** job - Builds and caches the Docker image
2. **data_ci** job - Pulls the image, starts MongoDB container, runs integration tests

### Environment Variables

Integration tests use these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_HOST` | `localhost` | MongoDB host |
| `MONGO_PORT` | `27017` | MongoDB port |
| `DUMP_NAME` | `sefaria_dump_5784-sivan-4` | Database name from dump |

## Test Structure

Integration tests are located in:

- `data/sefaria/pipelines/tanah-view/tests/aggregation_test.rs`

Tests use the `#[cfg_attr(not(feature = "integration"), ignore)]` attribute to skip when the `integration` feature is not enabled.

## Updating the Sefaria Dump

When Sefaria releases a new dump:

1. Update `DUMP_URL` and `DUMP_NAME` in `data/sefaria/mongodb-docker/Dockerfile`
2. Update `DUMP_NAME` default in test files if needed
3. The CI cache will be invalidated automatically due to the Dockerfile change
