#!/bin/sh
# Restore the build fixture as the same user that will run MongoDB.
set -eu

dbpath=${1:-/mongodb-data}
dump=${2:-/dump}
mkdir -p "$dbpath"
chown mongodb:mongodb "$dbpath"
gosu mongodb mongod --dbpath "$dbpath" --bind_ip 127.0.0.1 &
mongod_pid=$!

cleanup() {
    result=$?
    trap - EXIT
    # Preserve the restore/startup failure even if the child already exited.
    set +e
    if kill -0 "$mongod_pid" 2>/dev/null; then
        kill -TERM "$mongod_pid"
        wait "$mongod_pid"
    fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ready=false
for attempt in $(seq 1 60); do
    if ! kill -0 "$mongod_pid" 2>/dev/null; then
        echo "MongoDB exited before the build restore" >&2
        exit 1
    fi
    if mongosh --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; then
        ready=true
        break
    fi
    echo "Waiting for build MongoDB: attempt $attempt/60"
    sleep 1
done
if [ "$ready" != true ]; then
    echo "MongoDB missed its original build startup deadline" >&2
    exit 1
fi

mongorestore --drop "$dump"
count=$(mongosh --quiet --eval "db.getSiblingDB('sefaria').texts.countDocuments({})")
case "$count" in
    ''|*[!0-9]*) echo "Invalid restored document count" >&2; exit 1 ;;
esac
if [ "$count" -eq 0 ]; then
    echo "The restored Sefaria fixture is empty" >&2
    exit 1
fi
echo "Restored $count Sefaria documents"
kill -TERM "$mongod_pid"
wait "$mongod_pid"
trap - EXIT INT TERM
sync
