# MongoDB with Sefaria dump pre-loaded
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest
#
# Restore outside the default /data/db volume. Existing volume users copy the
# fixture on first start; ephemeral CI selects /mongodb-data directly, avoiding
# that full copy. BuildKit retains writes inside declared volumes too:
# https://docs.docker.com/reference/dockerfile/#volume

# Pin version+digest: the derived image is tagged by this directory's git tree
# hash, so the FROM line is the only lever that forces a rebuild when the base
# moves. 9.0.4 recognizes Ubuntu's backported kernel patch level
# (SERVER-131779), which lets mongod start on ubuntu-26.04 runners (#2524).
FROM mongo:9.0.4@sha256:452bdaf2127b8ff851e31410a267809b9829eded219979f2210e7c7efb85a058

# Fail the build if any stage of a pipeline (e.g. find | head) exits nonzero.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install curl for downloading the dump
# Use --no-install-recommends per Codacy guidelines
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl=8.18.* \
    && rm -rf /var/lib/apt/lists/*

# Download and extract Sefaria dump
# The dump URL may change - check https://github.com/Sefaria/Sefaria-Export for latest
ENV DUMP_URL=https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz

# Download, extract, and prepare the dump for mongorestore
# The archive extracts to a directory - we find it dynamically and rename to /dump
WORKDIR /tmp
RUN curl --fail --show-error --location "${DUMP_URL}" -o dump.tar.gz \
    && tar -xzf dump.tar.gz \
    && rm dump.tar.gz \
    && ls -la \
    && EXTRACTED_DIR=$(find . -mindepth 1 -maxdepth 1 -type d -print -quit) \
    && echo "Found extracted directory: $EXTRACTED_DIR" \
    && mv "$EXTRACTED_DIR" /dump

# Do not mask a failed restore behind shutdown cleanup. The supervised child
# owns its files as mongodb, so direct CI startup needs no ownership copy-up.
COPY restore.sh /usr/local/bin/restore-sefaria-data.sh
RUN sed -i 's/\r$//' /usr/local/bin/restore-sefaria-data.sh \
    && chmod +x /usr/local/bin/restore-sefaria-data.sh \
    && /usr/local/bin/restore-sefaria-data.sh \
    && rm -rf /dump

# Verify the data was actually written to disk in a separate RUN layer
# This ensures buildkit commits the /mongodb-data directory to the image
RUN echo "Verifying /mongodb-data exists and has data..." && \
    du -sh /mongodb-data && \
    test -d /mongodb-data && \
    test -n "$(find /mongodb-data -mindepth 1 -print -quit)" && \
    echo "Verification passed: /mongodb-data contains $(find /mongodb-data -mindepth 1 -maxdepth 1 | wc -l) items"

# Keep the existing default entrypoint and persistent-volume initialization.
# Ephemeral CI explicitly uses the official entrypoint with --dbpath /mongodb-data.
# Use sed to ensure LF line endings (in case of CRLF from Windows)
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Expose MongoDB port
EXPOSE 27017

ENTRYPOINT ["/entrypoint.sh"]
