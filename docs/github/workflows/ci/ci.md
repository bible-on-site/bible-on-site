# CI Workflow

| Workflow | Purpose |
|----------|---------|
| [`auto-create-pr`](../../../../.github/workflows/auto-create-pr.yml) | Auto-create PRs when publishing a branch |
| [`ci.yml`](../../../../.github/workflows/ci.yml) | Continuous Integration pipeline |
| [`shared-ci.yml`](../../../../.github/workflows/shared-ci.yml) | Shared CI components (change detection) |
| [`shared-dockerize.yml`](../../../../.github/workflows/shared-dockerize.yml) | Docker packaging |
| [`app-package.yml`](../../../../.github/workflows/app-package.yml) | App packaging (MSIX, AAB) |
| [`shared-release.yml`](../../../../.github/workflows/shared-release.yml) | Release automation |

## Key Features

### Module Change Detection
Each module (Website, API, App, Data) is checked for changes. CI jobs only run if:
- The module's source files changed, OR
- CI workflow files changed, OR
- Master coverage baseline is unavailable (ensures coverage reporting works)

### Coverage Baseline Availability
The `determine_baseline_availability` job checks if master coverage artifacts exist across all workflow runs using `gh api`. This prevents unnecessary CI runs when only unrelated modules changed.

### App Packaging
App packaging runs in parallel for Windows (MSIX) and Android (AAB)

## Architecture
![ci](./ci.svg)