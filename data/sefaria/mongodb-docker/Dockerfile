# MongoDB with Sefaria dump pre-loaded
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest
#
# The data is restored at BUILD TIME, so container startup is instant.
# This uses a shell background process (not --fork) to run mongod during build.

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

# Restore MongoDB data at BUILD TIME
# This makes container startup instant since data is already in the image
# We use shell background process (&) instead of --fork which doesn't work in buildkit
RUN mkdir -p /data/db && \
    mongod --dbpath /data/db --bind_ip 127.0.0.1 --nojournal & \
    MONGOD_PID=$! && \
    echo "Waiting for MongoDB to start (PID: $MONGOD_PID)..." && \
    for i in $(seq 1 30); do \
        if mongosh --quiet --eval "db.runCommand({ping:1})" 2>/dev/null; then \
            echo "MongoDB is ready"; \
            break; \
        fi; \
        echo "Attempt $i/30: waiting..."; \
        sleep 1; \
    done && \
    echo "Running mongorestore..." && \
    mongorestore --drop /dump && \
    echo "mongorestore completed. Document count:" && \
    mongosh --quiet --eval "db.getSiblingDB('sefaria').texts.countDocuments({})" && \
    echo "Stopping MongoDB..." && \
    mongosh --quiet --eval "db.adminCommand({shutdown:1})" || true && \
    wait $MONGOD_PID || true && \
    echo "Cleaning up dump files..." && \
    rm -rf /dump && \
    echo "Build-time restore complete!"

# Expose MongoDB port
EXPOSE 27017
