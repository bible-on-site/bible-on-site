# Build stage for Lambda-compatible binary (musl target).
# Build context must be web/ — ensure bulletin/ is included in web/.dockerignore.

# Perek text stage: the embedded corpus is generated from the pinned website
# dump at build time instead of being vendored (#3709). The Rust stage
# consumes only the generated file, so Node stays out of it.
FROM node:26.13.1-alpine AS extract
WORKDIR /app
COPY bulletin/scripts/extract-tanach-text.mjs ./bulletin/scripts/
COPY bible-on-site/src/data/db/sefaria-dump-*.tanah_view.json ./bible-on-site/src/data/db/
RUN node bulletin/scripts/extract-tanach-text.mjs

FROM rust:1.100.0-alpine AS build
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
COPY bulletin/build.rs ./bulletin/build.rs
COPY --from=extract /app/bulletin/data ./bulletin/data
COPY bulletin/fonts ./bulletin/fonts
COPY bulletin/assets/email ./bulletin/assets/email
# Shared branding: build.rs stages the Al Heperek TTFs into fonts/ and the
# PDF embeds the canonical derived header logo (#3708).
COPY shared/branding ./shared/branding
COPY api/entities ./api/entities

WORKDIR /app/bulletin
RUN cargo build --locked --release
