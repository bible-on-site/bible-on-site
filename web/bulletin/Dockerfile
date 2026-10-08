# Build stage for Lambda-compatible binary (musl target).
# Build context must be web/ — ensure bulletin/ is included in web/.dockerignore.

FROM rust:1.98.1-alpine AS build
WORKDIR /app

# Install host build dependencies.
# The pinned base image already fixes the toolchain; alpine
# renames versioned packages (clangNN/lldNN) per release, so apk pins would
# break on the next base bump for no reproducibility gain.
# hadolint ignore=DL3018
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
