# Build stage for Lambda-compatible binary (musl target).
# Build context must be web/ — ensure bulletin/ is included in web/.dockerignore.

ARG RUST_VERSION=1.93.1

FROM rust:${RUST_VERSION}-alpine AS build
WORKDIR /app

# Install host build dependencies.
RUN apk add --no-cache clang lld musl-dev git openssl-dev openssl-libs-static pkgconfig

# Copy source files (build context is web/)
# Preserve directory structure so ../api/entities path in Cargo.toml resolves correctly
COPY bulletin/src ./bulletin/src
COPY bulletin/Cargo.toml ./bulletin/Cargo.toml
COPY bulletin/Cargo.lock ./bulletin/Cargo.lock
COPY bulletin/data ./bulletin/data
COPY bulletin/fonts ./bulletin/fonts
COPY api/entities ./api/entities

WORKDIR /app/bulletin
RUN cargo build --locked --release
