# MongoDB with Sefaria dump pre-loaded
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest

FROM mongo:7

# Install curl for downloading the dump
# Use --no-install-recommends per Codacy guidelines
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Download and extract Sefaria dump
# The dump URL may change - check https://github.com/Sefaria/Sefaria-Export for latest
ENV DUMP_URL=https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz

WORKDIR /docker-entrypoint-initdb.d

# Download, extract, and prepare the dump for mongorestore
# The archive extracts to a directory - we find it dynamically and rename to /dump
RUN curl -L ${DUMP_URL} -o dump.tar.gz \
    && tar -xzf dump.tar.gz \
    && rm dump.tar.gz \
    && ls -la \
    && EXTRACTED_DIR=$(find . -maxdepth 1 -type d ! -name '.' | head -1) \
    && echo "Found extracted directory: $EXTRACTED_DIR" \
    && mv "$EXTRACTED_DIR" /dump

# Import the dump into MongoDB at build time
# This pre-populates the database so it's ready immediately when the container starts
# Note: mongod requires a data directory
RUN mkdir -p /data/db \
    && mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db \
    && sleep 5 \
    && mongorestore --drop /dump \
    && mongod --shutdown --dbpath /data/db

# Expose MongoDB port
EXPOSE 27017
