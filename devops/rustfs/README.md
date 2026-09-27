# RustFS for development and CI

Production storage remains AWS S3. Local development and Admin CI use the same
[Compose configuration](../docker-compose.yml): RustFS 1.0.0 and a Node.js
initializer using the locked AWS SDK dependencies. RustFS and Node images are
pinned by multi-platform image digest. No archived MinIO server or client is
built or downloaded. RustFS is Apache-2.0 licensed and needs no activation token.

From the repository root:

```bash
docker compose -f devops/docker-compose.yml up -d --wait --wait-timeout 180
docker compose -f devops/docker-compose.yml run --build --rm --no-deps rustfs-init
```

The S3 endpoint remains `http://localhost:4566`, with development-only credentials
`test` / `test_1234` and path-style access. The console is at
`http://localhost:9001`. Both ports bind only to loopback. RustFS runs as its
upstream non-root user (UID 10001); a separate non-root Node.js container creates
`bible-on-site-assets-dev` and `bible-on-site-assets-test`, enabling anonymous
downloads only. Bucket CORS permits reads and signed uploads from the local Admin
origins on port 3101. The initialization command must succeed before starting the app.
`npm run docker:up` runs both commands and stops on failure. Readiness checks wait for
storage and IAM, not just the process.

## Existing MinIO installations

RustFS uses a new `rustfs_data` named volume. The old `minio_data` volume is left
untouched; do not delete it or attach it to RustFS. Stop the old services with
`docker compose -f devops/docker-compose.yml down` **before switching from the old
checkout**, without `--volumes`. Then start the new configuration above.

Reseed generated assets with `npm run s3:populate:dev` from `web/admin`, or use
the existing development setup's sync-from-production workflow. Export any
locally created assets through S3 while the old server is still available, then
import them into RustFS. Keep the old volume until the imported data is verified.

## Verification and updates

With Admin dependencies installed and RustFS running:

```bash
cd web/admin
S3_ENDPOINT=http://localhost:4566 npm run test:s3
```

The smoke test uses a temporary bucket and checks authenticated upload/download,
anonymous read but not write, metadata, browser CORS, presigned upload/signature rejection,
listing, and deletion. It rejects non-loopback endpoints and cleans up its own
bucket. Admin CI runs it before the existing end-to-end tests and asset population.

Update image versions and digests together in Compose, then rerun initialization
(including an existing-volume restart), the smoke test, and Admin tests.
See the [upstream Docker guide](https://docs.rustfs.com/en/installation/container/docker).
