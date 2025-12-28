# Copilot Instructions

## Documentation References

When working on this repository, please refer to the relevant documentation under the `docs/` directory:

- **Repository Structure**: For you to navigate through the code base, read `docs/repo-structure/`
- **GitHub CI/CD**: For GitHub in general, for Actions, workflows, continuous integration, or continuous deployment topics, read `docs/github/`
- **AWS**: For AWS infrastructure, architecture, or related topics, read `docs/aws/`

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
- Test database: Use `DB_URL` env var or `.test.env` file. Populate with: `DB_URL="mysql://root:test_123@localhost:3306/tanah_test" npx tsx devops/populate-test-db.mts`
- Entities are in the `entities/` crate, services in `src/services/`, resolvers in `src/resolvers/`, DTOs in `src/dtos/`

### Playwright Tests (currently applies to website-e2e/perf, api-e2e)

#### Test Description Conventions

When writing tests, follow this naming convention for `describe` and `it`/`test` blocks:

- **Top-level `describe` blocks**: Use the subject being tested (e.g., component name, function name, module name)
- **Nested `describe` blocks**: Use contextual descriptions or scenarios (e.g., "when user is authenticated", "with invalid input")
- **Leaf `it`/`test` blocks**: Use expectation verbs describing the expected behavior (e.g., "returns the correct value", "throws an error", "renders the component")

Example:

```typescript
describe('UserService', () => {
  describe('getUser', () => {
    describe('when user exists', () => {
      it('returns the user object', () => { ... });
    });
    describe('when user does not exist', () => {
      it('throws UserNotFoundError', () => { ... });
    });
  });
});
```

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
