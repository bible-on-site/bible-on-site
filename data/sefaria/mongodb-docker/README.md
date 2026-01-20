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

The container expects these environment variables (with defaults):

- `DUMP_URL` - URL to download the Sefaria dump (default: Google Storage URL)
- `DUMP_NAME` - Name of the extracted dump directory (default: `sefaria_dump_5784-sivan-4`)

## CI Integration

In CI, this image is built, cached, and used to run data integration tests. See `.github/workflows/ci.yml` for the workflow configuration.

## Updating the Dump

When Sefaria releases a new dump:

1. Update `DUMP_URL` and `DUMP_NAME` in the Dockerfile
2. Rebuild the image
3. The CI cache will be invalidated automatically due to the Dockerfile change
