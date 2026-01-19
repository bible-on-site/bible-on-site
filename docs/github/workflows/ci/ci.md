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