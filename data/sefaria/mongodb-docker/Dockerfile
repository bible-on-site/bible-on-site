# MongoDB with Sefaria dump pre-loaded
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest
#
# Note: The dump is restored at first container startup.
# This uses the MongoDB docker-entrypoint-initdb.d mechanism with an inline script.

FROM mongo:7

# Install curl for downloading the dump
# Use --no-install-recommends per Codacy guidelines
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Download and extract Sefaria dump
# The dump URL may change - check https://github.com/Sefaria/Sefaria-Export for latest
ENV DUMP_URL=https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz

# Download, extract, and prepare the dump for mongorestore
# The archive extracts to a directory - we find it dynamically and rename to /dump
WORKDIR /tmp
RUN curl -L ${DUMP_URL} -o dump.tar.gz \
    && tar -xzf dump.tar.gz \
    && rm dump.tar.gz \
    && ls -la \
    && EXTRACTED_DIR=$(find . -maxdepth 1 -type d ! -name '.' | head -1) \
    && echo "Found extracted directory: $EXTRACTED_DIR" \
    && mv "$EXTRACTED_DIR" /dump

# Create init script inline to restore the dump on first startup
# The MongoDB docker-entrypoint.sh runs scripts in /docker-entrypoint-initdb.d/
# Note: This is an inline script in the Dockerfile, not a separate .sh file
# The script creates a marker file on completion that can be checked by the host
RUN printf '#!/bin/bash\nset -e\necho "Starting mongorestore..."\nmongorestore --drop /dump\necho "mongorestore completed successfully"\ntouch /tmp/mongorestore-complete\n' > /docker-entrypoint-initdb.d/restore-dump.sh \
    && chmod +x /docker-entrypoint-initdb.d/restore-dump.sh

# Expose MongoDB port
EXPOSE 27017
