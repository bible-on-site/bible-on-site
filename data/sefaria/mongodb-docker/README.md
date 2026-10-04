# MongoDB with Sefaria Dump Docker Image

This Docker image contains MongoDB with the Sefaria dump pre-loaded, used for running data integration tests in CI.

## Building

```bash
docker build -t sefaria-mongo:latest .
```

## Running

```bash
docker run -d -p 27017:27017 --name sefaria-mongo sefaria-mongo:latest
```

## Usage in Tests

Once the container is running, you can run the integration tests:

```bash
cd data
cargo test --features integration
```

## Environment Variables

The container uses these build-time variables:

- `DUMP_URL` - URL to download the Sefaria dump (default: Google Storage URL)

The dump is imported at build time, so the container starts with data pre-loaded.

## CI Integration

CI publishes this image to `ghcr.io/bible-on-site/sefaria-mongo`, tagged with the git tree hash of this directory, and Data CI and Perushim Data pull it. Fork pull requests cannot publish, so when they rebuild the image it reaches those jobs as a workflow artifact. See `.github/workflows/ci.yml` for the workflow configuration.

## Updating the Dump

When Sefaria releases a new dump:

1. Update `DUMP_URL` in the Dockerfile
2. Rebuild the image
3. Any change to this directory changes the image tag, so CI rebuilds and publishes the image
