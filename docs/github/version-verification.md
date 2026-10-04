# Version Verification

This document describes the automated version verification system that prevents duplicate version releases.

## Overview

The version verification system ensures that module versions are properly bumped before any release can occur. For pull requests and merge-queue checks of every module, the version must exceed both the last released tag and the version it merges onto: `master` for pull requests, and the merge-queue base (which includes PRs queued ahead) for merge-queue checks. This reserves a distinct version even while an earlier release is still running.

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

These jobs are conditional: they only run if the corresponding module has changes. Merge-queue checks detect changes against the merge-queue base, so a PR queued behind another one still has its own changes verified.

Website changes must bump `web/bible-on-site/package.json` and `package-lock.json` in the pull request. The release workflow does not bump the website version afterward. A later website pull request with the same version will fail verification against `master` and must choose the next version before merging.

### Auto Bump on Branch Pushes

The `Auto Bump Versions` workflow (`.github/workflows/auto-bump-versions.yml`) runs on every push to a branch other than `master` and merge-queue branches. It finds the modules the branch changes against `origin/master` and, for any whose version is not above both `master` and the latest release, commits a patch bump with `npm run bump:changed-modules` (`devops/github/ci/bump-changed-module-versions.ts`). It pushes with the deploy key so the PR checks rerun on the bumped head; pull before pushing again to a branch it bumped. Fork branches are not covered.

This mainly serves Renovate, which updates dependencies without bumping the modules they belong to. `renovate.json` lists the bump commit's author in `gitIgnoredAuthors`, so Renovate still treats its branch as its own and keeps rebasing it; each rebase drops the bump and the workflow adds it again. Renovate `postUpgradeTasks` would avoid the extra commit, but the Mend-hosted Renovate app only runs commands its administrator allows, so this repo cannot rely on them.

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

### "Website version X is NOT greater than origin/master version X"

Another website change has already reserved that version. Bump the website version above the current `master` version in both package files. Rerunning CI on the same commit will not resolve the collision.

### "Tag X was released from another commit"

The release job found an existing tag for this version that does not contain the pushed commit, so the commit's changes would never deploy. Release them by bumping the module version in a follow-up PR.

### A deployment tries to publish an existing website version

Check whether an earlier CD run already published that version. Rerunning a duplicate CD run cannot publish different code under the same version. Release the later website changes with a new version; the shared release workflow dispatches CD only after creating a new tag, so overlapping or rerun CI builds cannot dispatch the same release twice.

### Pre-commit hook not running

Ensure husky is installed:
```bash
npm install
npx husky install
```

### Version verification skipped unexpectedly

The verification only runs when the module directory has changes. Check that your changes are in the correct module directory.
