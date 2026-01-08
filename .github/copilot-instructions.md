# Copilot Instructions

## General Principles

- **Always prefer the latest stable version** of any toolset, framework, or package unless there's a specific compatibility concern.

## Tool Learning Protocol

When using a tool/library/framework for the first time:

1. Check `.github/tool-registry.md` for existing research
2. If missing/outdated: use Context7 (`resolve-library-id` → `get-library-docs`), official docs, or GitHub
3. Update registry with: tool name, version, date, key learnings
4. Apply learnings

## Known Workarounds

- **Terminal Commands**: Due to a temporary bug, always prepend a leading space before running any commands in terminal (e.g., ` cd /path && command` instead of `cd /path && command`).

## Documentation References

When working on this repository, please refer to the relevant documentation under the `docs/` directory:

- **Repository Structure**: For you to navigate through the code base, read `docs/repo-structure/`
- **GitHub CI/CD**: For GitHub in general, for Actions, workflows, continuous integration, or continuous deployment topics, read `docs/github/`
- **AWS**: For AWS infrastructure, architecture, or related topics, read `docs/aws/`
- **App**: For MAUI app development, build commands, and architecture, read `docs/app/`

## Investigation Tools

- **GitHub CLI (`gh`)**: Use the `gh` CLI for investigating GitHub-related issues (Actions runs, PRs, issues, etc.). Examples:
  - `gh run view <run-id> --log-failed` - View failed job logs
  - `gh run view <run-id> --json workflowName,event,conclusion` - Get run metadata
  - `gh api repos/<owner>/<repo>/commits/<sha>` - Get commit details

## Implementation Instructions

### General Instructions

- That's a Jewish Orthodox project, avoid any Christian terminology and reformist expressions
- Currently still use the Perakim division despite being a christian division and not the Parashot division.

### Terminology Instructions

When referring to religious texts in this repository, please use the following terminology consistently:

- Use the term Tanah instead of Bible
- Use the term Sefer instead of Book (Plural: Sefarim)
- Use the term Perek instead of Chapter (Plural: Perakim)
- Use the term Pasuk instead of Verse (Plural: Pesukim)
- Based on Ḥazal: שמואל, מלכים, עזרא, דברי הימים are not splitted into two books. In order to solve this mismatch, the splits are considered as a sub split under the same book. This term for this sub-split is "Additional". Usually followed by the perek name in UI.
  The addtionals for שמואל, מלכים ודברי הימים are א, ב. sometimes referred as 1, 2 in source code, and ע, נ or 70, 50 accordingly for עזרא.
- When referring to the books of the Tanah in the codebase, use their Hebrew names, and not their tanachUS names (I.E. בראשית instead of Genesis) unless there is a specific tanachUS related context.

### Implementation Instructions

When implementing features or making changes in this repository, please adhere to the following guidelines:

- **Never ignore compiler or linter errors/warnings.** Always fix issues reported by TypeScript, Rust, .NET compilers, Biome, ESLint, Clippy, or any other static analysis tool before committing code. Mainitain 0 problems in vscode (exception are currently: [{
  "resource": "<repo_root>/.github/workflows/ci.yml",
  "message": "Context access might be invalid: module_changed",
  }] and [{
  "resource": "<repo_root>/.github/workflows/ci.yml",
  "message": "Unable to find reusable workflow",
  }], and warnings for web/api until cleaned up).

### web/bible-on-site Instructions

When working on the `web/bible-on-site` project (website):

- Use playwright at http://localhost:3001 (`npm run dev` might be required if not already on)
- Use of client components is forbidden unless I explicitly ask for it
- Tests: `npm run test:unit` (unit), `npm run test:e2e` (e2e)
- Coverage: `npm run coverage:unit`, `npm run coverage:e2e`

#### Implementation Instructions

- When writing a test, and asserting non null using the framework, you can use the non null assertion operator after and decorate the usage with a linter suppression comment explaining why it's safe.
- When catching an error, log that it took place using console.warn or console.error.

### web/api Instructions

When working on the `web/api` project (Rust GraphQL API):

- The API uses `cargo-make` for task orchestration. Use `Makefile.toml` lifecycle commands:
  - `cargo make run-api` - Run the API server
  - `cargo make test-e2e` - Run E2E tests (starts API server automatically)
  - `cargo make coverage-e2e` - Run E2E tests with coverage
  - `cargo make lint` - Run Clippy linter
  - `cargo make clean` - Clean build artifacts
  - `cargo make package` - Build Docker image
- E2E tests are in `tests/e2e/` and use Playwright
- Test database: Use `DB_URL` env var or `.test.env` file. Populate with: `cd data && DB_URL="mysql://root:test_123@localhost:3306/tanah_test" cargo make mysql-populate`
- **MySQL CLI access**: Use `mysql -u root -ptest_123 tanah_test` to query test data directly (MySQL bin is at `/c/Program Files/MySQL/MySQL Server 8.4/bin` or in PATH)
- Entities are in the `entities/` crate, services in `src/services/`, resolvers in `src/resolvers/`, DTOs in `src/dtos/`

### Testing

For detailed testing philosophy, strategy, and conventions, see [`docs/tests/tests.md`](../docs/tests/tests.md).

#### E2E Tests (Playwright)

Applies to: website-e2e, website-perf, api-e2e

- **Website**: Uses Playwright with Monocart reporter
- **API**: Uses Playwright with cargo-make orchestration
- Test files located in `tests/e2e/` directories

### AWS Infrastructure Instructions

When working on the AWS infrastructure for this repository, please adhere to the following guidelines:

- connect using aws sso login --profile AdministratorAccess-<AccountID>
- Every accpeted change must be reflected in the infrastructure as code (IaC) templates located in the `infrastructure/` directory.
- Do not act the opposite, means, do not invoke CloudFormation based on templates located in the `infrastructure/` directory as they are currently for reference only and never really tested.

When modifying the AWS infrastructure process, always update `docs/aws/` to reflect the changes.

### Pre-commit Hooks

The repository uses pre-commit hooks managed by [pre-commit](https://pre-commit.com/):

- **Configuration**: `.pre-commit-config.yaml` at repository root
- **Python venv**: Located at `devops/.venv/` - activate with `source devops/.venv/Scripts/activate` (Windows) or `source devops/.venv/bin/activate` (Unix)
- **pyproject.toml**: Located at `devops/pyproject.toml` - tool configurations (e.g., `[tool.md_dead_link_check]`) go here
- **Husky integration**: Husky (npm) triggers pre-commit (Python) on git hooks. The `.husky/pre-commit` script calls `pre-commit run`

To run a specific hook manually:

```bash
source devops/.venv/Scripts/activate  # or bin/activate on Unix
pre-commit run <hook-id> --all-files
```

To add a new pre-commit hook:

1. Add the repo and hook configuration to `.pre-commit-config.yaml`
2. Add any tool-specific configuration to `devops/pyproject.toml` under the appropriate `[tool.*]` section (if it cannot be inlined in `.pre-commit-config.yaml`)

When modifying the pre-commit process, always update `docs/devops/pre-commit.md` to reflect the changes.

### Git Workflow

When committing changes:

1. **Before committing**, review staged changes for PII (Personally Identifiable Information) such as AWS account IDs, API keys, passwords, email addresses, or other sensitive data. Use `git diff --cached` to inspect.
2. After `git commit`, pre-commit hooks may apply auto-fixes (e.g., formatting, import sorting)
3. Before pushing, always check for unstaged changes: `git status`
4. If pre-commit modified files, stage and amend: `git diff-tree --no-commit-id --name-only -r HEAD | xargs git add && git commit --amend --no-edit` (only re-stages files from the original commit)
5. Only push after confirming no uncommitted auto-fixes remain

**Important**: Never merge a PR unless explicitly instructed to do so by the user.
