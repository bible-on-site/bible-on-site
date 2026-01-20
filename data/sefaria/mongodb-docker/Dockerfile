# MongoDB with Sefaria dump pre-loaded
# Used for CI integration tests
#
# Build: docker build -t sefaria-mongo:latest .
# Run: docker run -d -p 27017:27017 sefaria-mongo:latest

FROM mongo:7

# Install curl for downloading the dump
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

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

# Copy the initialization script
COPY init-mongo.sh /docker-entrypoint-initdb.d/

# Make the script executable
RUN chmod +x /docker-entrypoint-initdb.d/init-mongo.sh

# Expose MongoDB port
EXPOSE 27017
