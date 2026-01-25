# CI Workflow

| Workflow | Purpose |
|----------|---------|
| [`ci.yml`](../../../../.github/workflows/ci.yml) | Main CI pipeline (test, build, package, release) |
| [`shared-ci.yml`](../../../../.github/workflows/shared-ci.yml) | Shared change detection logic |
| [`shared-dockerize.yml`](../../../../.github/workflows/shared-dockerize.yml) | Docker image packaging |
| [`app-package.yml`](../../../../.github/workflows/app-package.yml) | App packaging (MSIX, AAB) |
| [`shared-release.yml`](../../../../.github/workflows/shared-release.yml) | Release automation (tag, GitHub Release, trigger CD) |
| [`auto-create-pr`](../../../../.github/workflows/auto-create-pr.yml) | Auto-create PRs when publishing a branch |

## Pipeline Stages

### 1. Setup & Detection
- **Setup Environment Variables**: Extract Playwright versions, set env vars
- **Determine Baseline Availability**: Check if master coverage artifacts exist (cross-workflow)
  - Downloads and re-uploads master artifacts to make them available in current run
- **Determine Changes**: Per-module change detection (Website, API, App, Data)
- **Build LCOV Docker Image**: Prepare coverage tooling

### 2. CI Jobs (Conditional)
Each module CI runs only if: module changed OR CI files changed OR baseline unavailable

| Job | Module | Tests |
|-----|--------|-------|
| Website CI | `web/bible-on-site` | Lint, Unit, E2E |
| Website Performance | `web/bible-on-site` | Lighthouse perf tests |
| API CI | `web/api` | Lint, E2E |
| App CI | `app` | Lint, Unit, Integration |
| Data CI | `data` | Lint, Unit |

### 3. Cross Module CI
- Restores coverage from module CIs (or master baseline if skipped)
- Publishes coverage to Codecov (per-module flags)
- Merges and publishes cross-module coverage to Codacy

### 4. Packaging (Master Only)
| Job | Output | Purpose |
|-----|--------|---------|
| Package Website | Docker `.tar.gz` | For AWS ECS |
| Package API | Docker `.tar.gz` | For AWS ECS |
| Package App | MSIX + AAB | For stores |

### 5. Release (Master Only)
- Creates Git tag and GitHub Release
- Triggers CD workflow via `repository_dispatch`

## Architecture
![ci](./ci.svg)

## Known Issues & Workarounds

### Reusable Workflow Result Evaluation Bug (GitHub Actions)

**Issue Reference:** [#1065](https://github.com/bible-on-site/bible-on-site/issues/1065)

**Problem:** GitHub Actions has a known issue where jobs depending on reusable workflows may be incorrectly skipped, even when the reusable workflow completes successfully. The `needs.X.result` and `needs.X.outputs.*` values don't propagate reliably in all cases.

**Symptom:** Release jobs (or other downstream jobs) get skipped with no clear reason, even though their upstream packaging jobs ran successfully.

**Workaround:** Use `always()` combined with explicit result checks in the `if` condition:

```yaml
# ❌ DON'T - May cause job to be skipped incorrectly
if: ${{ needs.package_website.outputs.module_version != '' && ... }}

# ✅ DO - Reliable pattern
if: ${{ always() && needs.cross_module_ci.result == 'success' && needs.package_website.result == 'success' && needs.package_website.outputs.module_version != '' && ... }}
```

**Rule: When Adding New Jobs That Depend on Reusable Workflows:**

1. **Always use `always()`** at the start of the `if` condition
2. **Explicitly check `.result == 'success'`** for ALL upstream reusable workflow jobs
3. **Then add your business logic conditions** (outputs, branch checks, etc.)

**Example - Adding a new release job:**
```yaml
release_new_module:
  name: Release New Module
  needs: [setup_env, determine_new_module_changes, cross_module_ci, package_new_module]
  # Note: Using always() + output check as a workaround for reusable workflow result evaluation issues (see #1065)
  # Also verify cross_module_ci and package_new_module passed to ensure quality gate
  if: ${{ always() && needs.cross_module_ci.result == 'success' && needs.package_new_module.result == 'success' && needs.package_new_module.outputs.module_version != '' && needs.determine_new_module_changes.outputs.module_changed == 'true' && needs.setup_env.outputs.is_master_branch == 'true' && github.event_name == 'push' }}
```

**Affected Jobs:** `release_website`, `release_api`, `release_app`
