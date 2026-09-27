# MinIO for development and CI

The Admin tests and local S3 environment use the same source-built MinIO server
and client. The public `minio/minio` and `minio/mc` image repositories are no longer
available. The Dockerfile therefore builds official source at fixed revisions,
including the server's October 2025 session-policy security fix. No production
storage is changed.

Upstream documented the distribution change and source-build instructions in its
[security release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z).

The source pins are in [Dockerfile](./Dockerfile). Update them deliberately and
verify server startup, bucket initialization, object upload/download, and Admin
tests together. These archived upstream projects are not a maintained production
storage solution.

From the repository root:

```bash
docker build --target server -t bible-on-site-minio:ci devops/minio
docker build --target client -t bible-on-site-minio-mc:ci devops/minio
```

Local development builds these same targets through
[`devops/docker-compose.yml`](../docker-compose.yml). Existing `minio_data` volumes
are preserved; the initialization service fails if bucket setup fails.
