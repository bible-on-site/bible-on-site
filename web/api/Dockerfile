# Note: Using classic docker build (DOCKER_BUILDKIT=0) for network:host support
# Do not add BuildKit-specific syntax directives (e.g. --mount)

ARG RUST_VERSION=1.92.0
ARG APP_NAME=api

################################################################################
# Create a stage for building the application.

FROM rust:${RUST_VERSION}-alpine AS build
ARG APP_NAME
WORKDIR /app

# Install host build dependencies.
RUN apk add --no-cache clang lld musl-dev git openssl-dev openssl-libs-static pkgconfig

# Copy source files (build context is web/)
COPY api/src ./src
COPY api/Cargo.toml ./Cargo.toml
COPY api/Cargo.lock ./Cargo.lock
COPY api/entities ./entities

# Build the application in release mode.
RUN cargo build --locked --release && \
    cp ./target/release/$APP_NAME /bin/server

################################################################################
# Create a new stage for running the application that contains the minimal
# runtime dependencies for the application. This often uses a different base
# image from the build stage where the necessary files are copied from the build
# stage.
FROM alpine:3.23.3 AS final

# Create a non-privileged user that the app will run under.
# See https://docs.docker.com/go/dockerfile-user-best-practices/
ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/nonexistent" \
    --shell "/sbin/nologin" \
    --no-create-home \
    --uid "${UID}" \
    appuser
USER appuser

# Copy the executable from the "build" stage.
COPY --from=build /bin/server /bin/

# Expose the port that the application listens on.
EXPOSE 3003

# What the container should run when it is started.
CMD ["/bin/server"]
