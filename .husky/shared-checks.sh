#!/bin/bash
# Shared pre-commit checks for a module
# Usage: shared-checks.sh <module_path>
# where module_path is one of: app, web/api, web/bible-on-site, web/bulletin

module_path="$1"

if [ -z "$module_path" ]; then
    echo "Usage: shared-checks.sh <module_path>"
    echo "  module_path: app, web/api, web/bible-on-site, or web/bulletin"
    exit 1
fi

# Map module path to module name for devops scripts
case "$module_path" in
    "web/bible-on-site") module_name="website" ;;
    "web/api") module_name="api" ;;
    "web/bulletin") module_name="bulletin" ;;
    "app") module_name="app" ;;
    *)
        echo "Unknown module: $module_path"
        exit 1
        ;;
esac

echo "Running shared checks for $module_path (module: $module_name)..."

# Version verification
echo "  Verifying version..."
cd ./devops
npm run verify-version -- --module "$module_name" || exit 1
cd - >/dev/null

echo "  ✅ Shared checks passed for $module_path"
