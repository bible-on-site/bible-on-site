# MongoDB with Sefaria dump pre-loaded
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest
#
# CRITICAL: The mongo:7 image declares /data/db as a VOLUME, which means
# any data written there during build is LOST when the container runs.
# To work around this, we restore to /mongodb-data (not a volume) and
# copy it to /data/db at container startup via a custom entrypoint.

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

# Restore MongoDB data at BUILD TIME to /mongodb-data (NOT /data/db which is a volume!)
# We use shell background process (&) instead of --fork which doesn't work in buildkit
RUN mkdir -p /mongodb-data && \
    mongod --dbpath /mongodb-data --bind_ip 127.0.0.1 --nojournal & \
    MONGOD_PID=$! && \
    echo "Waiting for MongoDB to start (PID: $MONGOD_PID)..." && \
    for i in $(seq 1 60); do \
        if mongosh --quiet --eval "db.runCommand({ping:1})" 2>/dev/null; then \
            echo "MongoDB is ready after attempt $i"; \
            break; \
        fi; \
        echo "Attempt $i/60: waiting..."; \
        sleep 1; \
    done && \
    echo "Running mongorestore..." && \
    mongorestore --drop /dump && \
    echo "mongorestore completed. Document count:" && \
    mongosh --quiet --eval "db.getSiblingDB('sefaria').texts.countDocuments({})" && \
    echo "Stopping MongoDB gracefully..." && \
    mongosh --quiet --eval "db.adminCommand({shutdown:1})" || true && \
    wait $MONGOD_PID 2>/dev/null || true && \
    echo "Cleaning up dump files..." && \
    rm -rf /dump && \
    echo "Build-time restore complete! Data is in /mongodb-data"

# Create a custom entrypoint script that copies data from /mongodb-data to /data/db
# on first startup, then starts mongod normally
# Use sed to ensure LF line endings (in case of CRLF from Windows)
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Expose MongoDB port
EXPOSE 27017

ENTRYPOINT ["/entrypoint.sh"]
