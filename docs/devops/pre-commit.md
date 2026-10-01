# Pre-Commit Hooks

This repository uses a multi-layer pre-commit hook system to ensure code quality before commits are made.

## Architecture

The pre-commit workflow is organized into three layers:

```
.husky/pre-commit (root)
├── Cross-module checks (Python pre-commit framework)
├── web/bible-on-site/.husky/pre-commit (Website module)
└── web/api/.husky/pre-commit (API module)
```

## Workflow Execution

When you commit, the root pre-commit hook runs and:

1. **Detects changed files** using `git diff --cached`
2. **Runs cross-module checks** if the devops Python venv is available
3. **Bumps the website version** above the latest remote `origin/master` and release tag when a website change needs it, updating and staging both package files. This step fetches the remote branch and tags, so it requires network access.
4. **Delegates to module-specific hooks** based on which files changed

## Cross-Module Checks

**Location:** [.pre-commit-config.yaml](../../.pre-commit-config.yaml)

**Prerequisite:** Python virtual environment at `devops/.venv`

These checks run on all staged files regardless of module:

| Hook | Description |
|------|-------------|
| `sync-pre-commit-deps` | Synchronizes pre-commit dependencies |
| `trailing-whitespace` | Removes trailing whitespace |
| `check-yaml` | Validates YAML syntax (excludes CloudFormation templates) |
| `check-ast` | Validates Python AST |
| `check-added-large-files` | Prevents large files from being committed |
| `check-xml` | Validates XML syntax |
| `check-case-conflict` | Detects case-insensitive filename conflicts |
| `check-symlinks` | Validates symlinks |
| `check-illegal-windows-names` | Detects Windows-incompatible filenames |
| `check-merge-conflict` | Detects unresolved merge conflicts |
| `mixed-line-ending` | Enforces consistent line endings |
| `check-json5` | Validates JSON5 syntax |
| `actionlint` | Lints GitHub Actions workflows |
| `md-dead-link-check` | Detects broken links in Markdown files |

The workflow linter uses a pinned [Astral actionlint revision](https://github.com/astral-sh/actionlint/commit/9e5dcb067e7cdcfe44d3f015ba9f2be4583466cb)
that validates GitHub's native `parallel`, `background` and `wait` steps, including
references to preceding background steps. The pinned revision also retains
Pyflakes integration. [Upstream support is still open](https://github.com/rhysd/actionlint/issues/693);
workflow lint remains enabled without ignored syntax errors.

## Website Module

**Trigger:** Changes in `web/bible-on-site/`

**Location:** [web/bible-on-site/.husky/pre-commit](../../web/bible-on-site/.husky/pre-commit)

| Step | Command | Description |
|------|---------|-------------|
| Lint | `npm run lint` | Runs Biome linter/formatter |
| Unit Tests | `npm run test:unit` | Runs Jest unit tests |

## API Module

**Trigger:** Changes in `web/api/`

**Location:** [web/api/.husky/pre-commit](../../web/api/.husky/pre-commit)

| Step | Command | Description |
|------|---------|-------------|
| Lint | `cargo make lint` | Runs Clippy and formatting checks |
