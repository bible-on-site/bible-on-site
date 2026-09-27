# MinIO's public server/client images are unavailable. Build the official source
# at fixed revisions instead; both targets are for local development and CI only.
FROM golang:1.26-alpine AS builder
ENV CGO_ENABLED=0 GOBIN=/out
RUN apk add --no-cache git

FROM builder AS server-build
# Includes the October 2025 session-policy security fix.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go install -p 2 -trimpath -ldflags="-s -w" github.com/minio/minio@7aac2a2c5b7c882e68c1ce017d8256be2feea27f

FROM builder AS client-build
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go install -p 2 -trimpath -ldflags="-s -w" github.com/minio/mc@77f82e18b5401a65958f1619df6ebb994634bd88

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates curl

FROM runtime AS server
COPY --from=server-build /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]

FROM runtime AS client
COPY --from=client-build /out/mc /usr/local/bin/mc
ENTRYPOINT ["mc"]
