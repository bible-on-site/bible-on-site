#!/usr/bin/env bash
while [[ $# -gt 0 ]]; do
    case "$1" in
    -v)
        original_version="$2"
        shift # past argument
        shift # past value
        ;;
    *)
        echo "Unknown parameter passed: $1"
        exit 1
        ;;
    esac
done
if [[ -z "${original_version}" ]]; then
    echo "No version provided, using the current version from Cargo.toml"
    original_version=$(cargo make version | grep -v 'INFO') || {
        echo "Failed to get the current version from Cargo.toml"
        exit 1
    }
fi
echo "Calculating version bump for ${original_version}"
bumped_version=$(echo "${original_version}" | semver-bump patch) || {
    echo "Failed to calculate bumped version"
    exit 1
}
echo "Bumping version from ${original_version} to ${bumped_version}"
tomato set package.version "${bumped_version}" Cargo.toml || {
    echo "Failed to set bumped version in Cargo.toml"
    exit 1
}
echo "Updating Cargo.lock to reflect new version"
cargo generate-lockfile || {
    echo "Failed to update Cargo.lock"
    exit 1
}
