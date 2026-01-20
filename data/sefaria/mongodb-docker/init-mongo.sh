#!/bin/bash
# Initialize MongoDB with Sefaria dump
# This script is executed by MongoDB's docker-entrypoint when the container starts

set -e

echo "🚀 Importing Sefaria dump into MongoDB..."

# The dump directory name from the archive
DUMP_NAME="${DUMP_NAME:-sefaria_dump_5784-sivan-4}"

# Wait for MongoDB to be ready
until mongosh --eval "print('MongoDB is ready')" > /dev/null 2>&1; do
    echo "Waiting for MongoDB to start..."
    sleep 1
done

# Import the dump
mongorestore --drop /dump

echo "✅ Sefaria dump imported successfully!"
