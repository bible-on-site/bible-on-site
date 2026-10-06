# Pre-Commit Hooks

This repository uses [pre-commit](https://pre-commit.com/) hooks to ensure code quality before commits are made.

## Architecture

pre-commit owns the git hooks directly — there is no Husky/npm layer:

```
.git/hooks/pre-commit     (installed by `pre-commit install`)
├── Cross-module checks (pre-commit framework)
└── Module checks (local hooks, gated by `files:` patterns)
.git/hooks/post-commit    (installed by `pre-commit install --hook-type post-commit`)
└── flip-book-local-restore
```

## Hook Installation

The hooks are installed automatically by:

- `npm install` / `npm ci` at the repo root — the `prepare` script runs `devops/install-git-hooks.mjs`.
- `devops/setup-dev-env.mts` — calls the same script after creating `devops/.venv`.

The installer prefers the `devops/.venv` pre-commit so the hooks keep working
without activating the venv, falls back to a `pre-commit` on `PATH`, detaches a
stale Husky `core.hooksPath` (`.husky/_`) when present, and skips silently
outside a git worktree (e.g. `npm pack`, Docker builds).

## Workflow Execution

When you commit, the `pre-commit` git hook runs the framework, which:

1. **Computes the staged file set** — during a merge commit, files are compared
   against `MERGE_HEAD` so incoming (already-published) changes don't trigger
   module checks; `devops/precommit-run.mjs` re-derives the same set inside the
   module hooks.
2. **Runs cross-module checks** on matching staged files.
3. **Runs module checks** whose `files:` pattern matches — each executes inside
   its module directory via `devops/precommit-run.mjs` (single-command modules)
   or `devops/precommit-rust.mjs` (per-module cargo-make tasks); the
   merge-aware change detection lives in `devops/precommit-changes.mjs`.
4. **Post-commit**: `flip-book-local-restore` restores the local
   `html-flip-book-react` dependency when the pre-commit guard switched it to
   npm for the commit.

## Cross-Module Checks

**Location:** [.pre-commit-config.yaml](../../.pre-commit-config.yaml)

**Prerequisite:** `pre-commit` installed (Python), typically via `devops/.venv`

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
| `check-illegal-windows-names` | Detects Windows-reserved filenames (incl. `nul`) |
| `check-merge-conflict` | Detects unresolved merge conflicts |
| `mixed-line-ending` | Enforces consistent line endings |
| `check-json5` | Validates JSON5 syntax |
| `actionlint` | Lints GitHub Actions workflows |
| `check-app-version` | Keeps app display version and platform build numbers aligned |
| `hadolint` | Lints Dockerfiles ([hadolint-py](https://github.com/AleksaC/hadolint-py) ships the binary as a wheel — no Docker daemon or system install needed, so it also runs on pre-commit.ci) |
| `md-dead-link-check` | Detects broken links in Markdown files |

The workflow linter uses a pinned [Astral actionlint revision](https://github.com/astral-sh/actionlint/commit/9e5dcb067e7cdcfe44d3f015ba9f2be4583466cb)
that validates GitHub's native `parallel`, `background` and `wait` steps, including
references to preceding background steps. The pinned revision also retains
Pyflakes integration. [Upstream support is still open](https://github.com/rhysd/actionlint/issues/693);
workflow lint remains enabled without ignored syntax errors.

## Module Checks

These run only when staged files fall under the module (`files:` pattern), and
each executes in the module directory. Hooks self-skip (exit 0) when the
toolchain they need isn't installed — `web-unit-tests` without
`web/bible-on-site/node_modules`, `web-rust-checks` without `cargo-make` or a
module `target/` dir — so they no-op safely on pre-commit.ci and fresh clones
while the module CI jobs remain the authoritative remote gate. The post-commit
`flip-book-local-restore` never runs on pre-commit.ci by design.

| Hook | Trigger | Command | Description |
|------|---------|---------|-------------|
| `biome-lint` | `web/bible-on-site`, `web/admin` code files | per-module `biome lint` on staged files | Lint via [devops/precommit-biome.mjs](../../devops/precommit-biome.mjs) |
| `flip-book-npm-dep` | `web/bible-on-site` | `npm run flip-book:check` → `flip-book:npm` + stage | Keeps `html-flip-book-react` on the npm version in commits ([devops/flip-book-dep.mjs](../../devops/flip-book-dep.mjs)) |
| `web-unit-tests` | `web/bible-on-site` | `npm run test:unit` | Website unit tests (Jest) |
| `web-rust-checks` | `web/api`, `web/bulletin` | `cargo make lint` (+ `fmt-check` for bulletin) | Rust lint/format via [devops/precommit-rust.mjs](../../devops/precommit-rust.mjs) |
| `flip-book-local-restore` | post-commit | `npm run flip-book:local` | Restores local flip-book dep when the guard switched it |
