# Version Verification

This document describes the automated version verification system that prevents duplicate version releases.

## Overview

The version verification system ensures that module versions are properly bumped before any release can occur. This prevents CD (Continuous Deployment) failures caused by attempting to release a version that has already been tagged.

## How It Works

### Pre-Commit Hook

When committing changes to a module (app, web/api, or web/bible-on-site), the pre-commit hook automatically verifies that the current version is greater than the last released version.

```bash
# The hook runs automatically on commit
git commit -m "feat: add new feature"

# If version is not bumped, commit fails with:
# ❌ ERROR: app version 4.0.15 is NOT greater than released version 4.0.15
# Please bump the version in app/BibleOnSite/BibleOnSite.csproj before merging.
```

### CI Version Verification Jobs

The CI workflow includes version verification jobs that run when a module changes:

- `Verify Website Version` - Runs when `web/bible-on-site` changes
- `Verify API Version` - Runs when `web/api` changes
- `Verify App Version` - Runs when `app` changes

These jobs are conditional - they only run if the corresponding module has changes. If a module hasn't changed, version verification is skipped for that module.

### Cross Module CI Integration

The `cross_module_ci` job validates version verification results:
- If a module changed and its version verification failed → CI fails
- If a module didn't change → version verification is skipped (passes)
- All version checks must pass for the CI to succeed

## Module Version Files

| Module | Version File | Version Command |
|--------|-------------|-----------------|
| App | `app/BibleOnSite/BibleOnSite.csproj` | `dotnet run --project devops -- Version` |
| API | `web/api/Cargo.toml` | `cargo make version` |
| Website | `web/bible-on-site/package.json` | `npm run version --silent` |

## Tag Format

Released versions are tracked via git tags:
- App: `app-v{version}` (e.g., `app-v4.0.15`)
- API: `api-v{version}` (e.g., `api-v0.1.13`)
- Website: `website-v{version}` (e.g., `website-v0.2.204`)

## DevOps Scripts

The version verification logic is implemented in the `devops/` directory:

- `devops/get-module-version.ts` - Module configuration and version extraction
- `devops/github/release/get-version.ts` - Get latest released version from git tags
- `devops/github/ci/is-version-newer-than-baseline.ts` - CI verification script

### Running Locally

```bash
# Verify all changed modules
cd devops
npm run verify-version

# Verify a specific module
npm run verify-version -- --module app
npm run verify-version -- --module api
npm run verify-version -- --module website
```

## Bypassing (Not Recommended)

In exceptional cases, you can bypass the pre-commit hook:

```bash
git commit --no-verify -m "message"
```

⚠️ **Warning**: Bypassing the hook will cause CI to fail if the version is not bumped. The CI version verification cannot be bypassed.

## Branch Protection

The `master` branch requires the `Cross Module CI` status check to pass before merging. This ensures:
1. All module tests pass
2. Version verification passes for any changed modules
3. Coverage requirements are met

## Troubleshooting

### "Version X is NOT greater than released version X"

This error means you need to bump the version before committing:

1. **App**: Edit `app/BibleOnSite/BibleOnSite.csproj` and increment `ApplicationDisplayVersion`
2. **API**: Edit `web/api/Cargo.toml` and increment `version`
3. **Website**: Run `npm version patch` (or minor/major) in `web/bible-on-site`

### Pre-commit hook not running

Ensure husky is installed:
```bash
npm install
npx husky install
```

### Version verification skipped unexpectedly

The verification only runs when the module directory has changes. Check that your changes are in the correct module directory.
