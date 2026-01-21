#!/bin/sh
# Custom entrypoint for Sefaria MongoDB Docker image
# This script copies pre-restored data from /mongodb-data to /data/db
# on first startup, then runs mongod.
#
# Why this is needed:
# The mongo:7 image declares /data/db as a VOLUME, which means any data
# written there during docker build is LOST when the container runs.
# To work around this, we restore data to /mongodb-data at build time,
# then copy it to /data/db at container startup.

set -e

echo "Sefaria MongoDB starting..."

# Check if /data/db is empty (first startup)
if [ ! -f /data/db/.initialized ]; then
    echo "First startup: copying pre-restored data from /mongodb-data to /data/db..."

    # Check if source directory exists
    if [ ! -d /mongodb-data ]; then
        echo "ERROR: /mongodb-data does not exist! Build-time restore may have failed."
        ls -la /
        exit 1
    fi

    # Copy all files from /mongodb-data to /data/db
    # Using cp -a to preserve permissions and attributes
    cp -a /mongodb-data/. /data/db/

    # Create marker file to indicate data has been initialized
    touch /data/db/.initialized

    echo "Data copy complete!"
else
    echo "Data already initialized, skipping copy."
fi

# Fix ownership (mongod runs as mongodb user)
chown -R mongodb:mongodb /data/db

# Start mongod with default settings
# The original mongo:7 entrypoint uses docker-entrypoint.sh
# We call the original entrypoint script to get proper signal handling
# Pass 'mongod' as the command if no arguments were provided
if [ $# -eq 0 ]; then
    exec docker-entrypoint.sh mongod
else
    exec docker-entrypoint.sh "$@"
fi
