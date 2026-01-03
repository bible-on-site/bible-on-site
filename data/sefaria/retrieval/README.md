# Sefaria Data Retrieval

## Overview

This directory contains documentation for accessing Sefaria's exported data.

## Data Source

Sefaria provides MongoDB exports of their entire database:

- **Repository**: https://github.com/Sefaria/Sefaria-Export
- **Small dump download**: https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz

## Retrieval Instructions

### 1. Download the dump

```bash
# Create the .raw directory (gitignored)
mkdir -p ../sefaria/.raw

# Download the small dump
curl -L https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz -o ../sefaria/.raw/dump_small.tar.gz

# Extract
cd ../sefaria/.raw
tar -xzf dump_small.tar.gz
```

The extracted dump will be at `.raw/sefaria_dump_<date>/` (e.g., `sefaria_dump_5784-sivan-4`).

### 2. Import to MongoDB

After setting up MongoDB (see `../setup-and-population`), use `cargo make sefaria-populate` to import the data.