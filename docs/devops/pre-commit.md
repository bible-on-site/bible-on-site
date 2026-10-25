# Pre-Commit Hooks

This repository runs its git hooks with [prek](https://prek.j178.dev/), a Rust
drop-in for [pre-commit](https://pre-commit.com/) that reads the same
`.pre-commit-config.yaml` — hooks stay compatible with pre-commit.ci and with
`pre-commit` for anyone who has not switched.

## Architecture

prek owns the git hooks directly — there is no Husky/npm layer:

```
.git/hooks/pre-commit     (installed by `prek install`)
├── Cross-module checks (prek framework)
└── Module checks (local hooks, gated by `files:` patterns)
.git/hooks/post-commit    (installed by `prek install --hook-type post-commit`)
└── flip-book-local-restore
```

## Hook Installation

The hooks are installed automatically by:

- `bun install` / `bun install --frozen-lockfile` at the repo root — the `prepare` script runs `devops/install-git-hooks.mjs`.
- `devops/setup-dev-env.mts` — calls the same script after creating `devops/.venv`.

The installer prefers the `devops/.venv` prek so the hooks keep working
without activating the venv, falls back to `prek` on `PATH`, then to
`pre-commit`, detaches a stale Husky `core.hooksPath` (`.husky/_`) when
present, and skips silently outside a git worktree (e.g. `npm pack`, Docker
builds).

## Parallel Execution

Hooks carry an optional `priority` field (prek-only): hooks sharing a
priority run concurrently, lower priorities run first. The config uses three
tiers — mutating fixers first (`sync-pre-commit-deps` 0, `trailing-whitespace`
1, `mixed-line-ending` 2), then `flip-book-npm-dep` alone (5, it rewrites and
stages `package.json`/`bun.lock`), then every read-only check in parallel
(10). pre-commit parses but ignores the field, so pre-commit.ci keeps its
sequential order.

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

**Prerequisite:** `prek` installed, typically via `devops/.venv` (or `pre-commit` — the config stays compatible)

These checks run on all staged files regardless of module:

| Hook | Description |
|------|-------------|
| `sync-pre-commit-deps` | Synchronizes pre-commit dependencies |
| `trailing-whitespace` | Removes trailing whitespace |
| `check-yaml` | Validates YAML syntax (excludes CloudFormation templates) |
| `check-toml` | Validates TOML syntax (Cargo.toml, pyproject.toml, Makefile.toml, fly.toml) |
| `check-json` | Validates JSON syntax |
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
| `ruff-check` | Python lint scoped to Codacy-parity rules (`F` pyflakes, `D2` docstring structure, `BLE001` blind except, `E722` bare except, `S110` try-except-pass, `RET502` mixed returns) |
| `gitleaks` | Scans staged files for committed secrets/keys (automates the staged-PII review in git-practices) |

The workflow linter uses a pinned [Astral actionlint revision](https://github.com/astral-sh/actionlint/commit/9e5dcb067e7cdcfe44d3f015ba9f2be4583466cb)
that validates GitHub's native `parallel`, `background` and `wait` steps, including
references to preceding background steps. The pinned revision also retains
Pyflakes integration. [Upstream support is still open](https://github.com/rhysd/actionlint/issues/693);
workflow lint remains enabled without ignored syntax errors.

## Module Checks

These run only when staged files fall under the module (`files:` pattern), and
each executes in the module directory. Every local hook declares
`language: node`, so prek (or pre-commit) provisions a managed Node toolchain
per hook — no system `node` on `PATH` required. Each hook lists
`@types/node` as its `additional_dependencies` bootstrap package because
pre-commit >=4.6 requires node hooks to declare at least one dependency; the
wrapper scripts themselves are stdlib-only. Hooks still self-skip (exit 0)
when the module toolchain they need isn't installed — `web-unit-tests`
without `web/bible-on-site/node_modules`, `rust-checks` without `cargo-make`
or a module `target/` dir — so they no-op safely on pre-commit.ci and fresh
clones while the module CI jobs remain the authoritative remote gate. The
post-commit `flip-book-local-restore` never runs on pre-commit.ci by design.

| Hook | Trigger | Command | Description |
|------|---------|---------|-------------|
| `biome-lint` | `web/bible-on-site`, `web/admin` code files | per-module `biome lint` on staged files | Lint via [devops/precommit-biome.mjs](../../devops/precommit-biome.mjs) |
| `flip-book-npm-dep` | `web/bible-on-site` | `bun run flip-book:check` → `flip-book:npm` + stage | Keeps `html-flip-book-react` on the npm version in commits ([devops/flip-book-dep.mjs](../../devops/flip-book-dep.mjs)) |
| `web-unit-tests` | `web/bible-on-site` | `bun run test:unit` | Website unit tests (Jest) |
| `admin-unit-tests` | `web/admin` | `bun run test:unit` | Admin unit tests (vitest) |
| `rust-checks` | `web/api`, `web/bulletin`, `data` | `cargo make lint` (+ `fmt-check` for bulletin and data) | Rust lint/format via [devops/precommit-rust.mjs](../../devops/precommit-rust.mjs) |
| `dotnet-analyzers` | `app/**` `.cs`/`.csproj`, `.editorconfig`, `global.json`, `Directory.Build.props` | `dotnet build` per touched project | SonarAnalyzer severities fail locally instead of surfacing as post-push annotations ([devops/precommit-dotnet.mjs](../../devops/precommit-dotnet.mjs)); skips projects without a prior restore |
| `codacy-gate` | `*.rs`, JS/TS files | `node devops/codacy-gate.mjs` | Codacy parity checks with no analyzer equivalent ([devops/codacy-gate.mjs](../../devops/codacy-gate.mjs)) |
| `setup-node-cache` | `.github/workflows/**` | `node devops/github/ci/setup-node-cache.mjs` | Rejects `actions/setup-node` `cache:` values outside `npm`/`yarn`/`pnpm` and dangling `cache-dependency-path` inputs at commit time — the failing jobs are master/release-only so workflow lint never executes them (#2643) ([devops/github/ci/setup-node-cache.mjs](../../devops/github/ci/setup-node-cache.mjs)) |
| `parasha-aliyot-drift` | aliyah importer / vendored source / generated JSON | `node devops/import-parasha-aliyot.mjs --check` | Fails when the generated `parasha-aliyot.json` drifts from the vendored hebcal source or importer ([devops/import-parasha-aliyot.mjs](../../devops/import-parasha-aliyot.mjs)) |
| `flip-book-local-restore` | post-commit | `bun run flip-book:local` | Restores local flip-book dep when the guard switched it |

## Codacy Parity

Recurring Codacy findings used to surface only as post-push annotations on
merged PRs. Each recurring pattern is now gated locally, in whichever layer
the repo's toolchains can enforce it:

| Codacy finding | Local gate |
|----------------|------------|
| Missing curly braces / `if` without block (S121) | `SonarAnalyzer.CSharp` (`app/Directory.Build.props`) + `.editorconfig` `[*.cs]` severities → `dotnet build` error |
| Optional parameters should be overloads (S2360) | Same analyzer set (Sonar rule severities in `.editorconfig`) |
| Unused method parameters (S1172) | Same |
| Floating-point exact equality (S1244) | Same |
| Switch without `default` (S131) | Same |
| Public `const` fields (S3869 family) | Same (generated `FluentUI.cs` constants are excluded — regenerating that file would undo any manual conversion) |
| Commented-out code (S125) | Same |
| Generic `catch (Exception)` (S2221) | Same — `dotnet-analyzers` + `.editorconfig` severity `error`. Deliberate failure boundaries carry the dual convention: `//NOSONAR` with a reason for Codacy/Qodana **plus** `#pragma warning disable/restore S2221` for the Roslyn analyzer (which does not honor `//NOSONAR`). The rule does not fire inside test methods. |
| Undisposed `IDisposable` locals (S2930) | Same analyzer set |
| `readonly` candidate fields (S2933) | Same |
| Explicit `GC.Collect()` (S1215) | Same — memory tests use `BibleOnSite.Tests.Support.GarbageCollection.CollectCycles()`, which carries the justification once |
| Loop → LINQ `Where`/`Select` (S3267) | Same |
| Unreachable conditional code / identical binary operands (S2583, S1764) | Same |
| Instance member writing a `static` field (S2696) | Same |
| Missed ternary / simple `using` (IDE0045, IDE0063) | Same (`dotnet_style`/`csharp_style` preferences set to `error`) |
| Python blind/bare/silent excepts, mixed implicit returns | `ruff-check` (`BLE001`, `E722`, `S110`, `RET502`) |
| `new RegExp(nonLiteral)` / ReDoS vector | `codacy-gate` — the constructor's first argument must be a literal |
| `String.prototype.replaceAll` | `codacy-gate` — use `.replace(/pattern/g, ...)` (not transpiled for older browsers) |
| `env::args`/`args_os` on security decisions | `codacy-gate` — call sites need an adjacent `nosemgrep` justification (same convention Semgrep honors on Codacy) |
| Python unused imports / docstring layout | `ruff-check` pre-commit hook (`--select F,D2`: pyflakes + docstring structure) |

**Gaps that remain Codacy-only:** Codacy's SQL dialect checks parse MySQL/SQLite
files as T-SQL and report syntax errors on valid dialect syntax — the affected
files stay in `.codacy.yml` `exclude_paths`, and the local gate intentionally
does not replicate dialect parsing. Its "unicode characters in a non-unicode
string" finding is the same T-SQL idiom: MySQL literals take the column charset
(utf8mb4), and the `N'...'` introducer the finding demands is a syntax error
(1064) in `COMMENT` clauses — the affected files are excluded in `.codacy.yml`
as well rather than gated locally. XSS-style sinks (`dangerouslySetInnerHTML`)
and HTML-injection findings also have no local equivalent and remain review-time
checks. The loop-increment/stop-condition findings map to Sonar rules whose
severity is configured in `.editorconfig`; anything Codacy flags outside that
rule set is documented in `.codacy.yml`.
