# MongoDB with Sefaria dump pre-loaded at BUILD TIME
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest
#
# Note: Data is restored during Docker build, not at container startup.
# This makes container startup instant (~1 second) instead of waiting for mongorestore.

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

# Restore data at BUILD TIME (not runtime) for instant container startup
# 1. Start MongoDB in background
# 2. Wait for it to be ready
# 3. Run mongorestore
# 4. Shutdown MongoDB gracefully (ensures data is flushed to disk)
# 5. Clean up dump files to reduce image size
RUN mongod --fork --logpath /var/log/mongodb/mongod.log --dbpath /data/db \
    && sleep 2 \
    && mongorestore --drop /dump \
    && mongod --shutdown \
    && rm -rf /dump /var/log/mongodb/mongod.log

# Expose MongoDB port
EXPOSE 27017
