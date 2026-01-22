# Implementation Practices

## Project Context

This is a Jewish Orthodox project. Avoid any Christian terminology and reformist expressions. Currently still using the Perakim division despite being a Christian division and not the Parashot division.

## Terminology

When referring to religious texts in this repository, use the following terminology consistently:

| Use This | Instead Of |
| -------- | ---------- |
| Tanah | Bible |
| Sefer (Pl: Sefarim) | Book |
| Perek (Pl: Perakim) | Chapter |
| Pasuk (Pl: Pesukim) | Verse |

### Book Division Notes

Based on Ḥazal: שמואל, מלכים, עזרא, דברי הימים are not split into two books. To solve this mismatch, the splits are considered as a sub-split under the same book. The term for this sub-split is "Additional", usually followed by the perek name in UI.

| Book | Additionals | Source Code Reference |
| ---- | ----------- | --------------------- |
| שמואל | א, ב | 1, 2 |
| מלכים | א, ב | 1, 2 |
| דברי הימים | א, ב | 1, 2 |
| עזרא | ע, נ | 70, 50 |

When referring to the books of the Tanah in the codebase, use their Hebrew names (e.g., בראשית instead of Genesis) unless there is a specific tanachUS-related context.

## Code Quality

**Never ignore compiler or linter errors/warnings.** Always fix issues reported by:

- TypeScript
- Rust (Clippy)
- .NET compilers
- Biome
- ESLint
- Any other static analysis tool

Maintain 0 problems in VS Code.

### Known Exceptions

The following are currently expected and can be ignored:

```json
[
  {
    "resource": "<repo_root>/.github/workflows/ci.yml",
    "message": "Context access might be invalid: module_changed"
  },
  {
    "resource": "<repo_root>/.github/workflows/ci.yml",
    "message": "Unable to find reusable workflow"
  }
]
```

## Module-Specific Instructions

### web/bible-on-site (Website)

**Development:**

- Use Playwright at http://localhost:3001 (`npm run dev` might be required if not already running)
- **Prefer server components for content.** The rule of thumb:
  - **Content-rich components** (text, articles, sections) → **SSG/SSR only** for best SEO and AIO (AI Optimization)
  - **Interactive/glue components** (navigation, animation, scroll-to-section, menu close) → **Client components OK**
  - Client components are acceptable when:
    - The component handles navigation/animation/UI glue logic
    - It's minimal and isolated (not wrapping content)
    - The actual content is still server-rendered
  - SSG still works with client components - the initial HTML is server-rendered, client code hydrates for interactivity

**Commands:**

| Task | Command |
| ---- | ------- |
| Unit Tests | `npm run test:unit` |
| E2E Tests | `npm run test:e2e` |
| Unit Coverage | `npm run coverage:unit` |
| E2E Coverage | `npm run coverage:e2e` |

**Implementation Notes:**

- When writing a test and asserting non-null using the framework, you can use the non-null assertion operator after and decorate the usage with a linter suppression comment explaining why it's safe
- When catching an error, log that it took place using `console.warn` or `console.error`

### web/api (Rust GraphQL API)

**Development:**

The API uses `cargo-make` for task orchestration. Use `Makefile.toml` lifecycle commands:

| Task | Command |
| ---- | ------- |
| Run API Server | `cargo make run-api` |
| E2E Tests | `cargo make test-e2e` |
| E2E Coverage | `cargo make coverage-e2e` |
| Lint | `cargo make lint` |
| Clean | `cargo make clean` |
| Build Docker Image | `cargo make package` |

**Testing:**

- E2E tests are in `tests/e2e/` and use Playwright
- Test database: Use `DB_URL` env var or `.test.env` file
- Populate test database:
  ```bash
  cd data && DB_URL="mysql://root:test_123@localhost:3306/tanah_test" cargo make mysql-populate
  ```

**MySQL CLI Access:**

```bash
mysql -u root -ptest_123 tanah_test
```

MySQL bin is at `/c/Program Files/MySQL/MySQL Server 8.4/bin` or in PATH.

**Project Structure:**

- Entities: `entities/` crate
- Services: `src/services/`
- Resolvers: `src/resolvers/`
- DTOs: `src/dtos/`

### AWS Infrastructure

When working on the AWS infrastructure:

- Connect using: `aws sso login --profile AdministratorAccess-<AccountID>`
- Every accepted change must be reflected in the IaC templates in `infrastructure/`
- Do **not** invoke CloudFormation based on templates in `infrastructure/` as they are currently for reference only and never really tested

When modifying the AWS infrastructure process, always update `docs/aws/` to reflect the changes.

### GitHub Actions Workflows

Before modifying `.github/workflows/` files:

1. **Re-enable GitHub Actions extension** in VS Code:
   - Install `github.vscode-github-actions` if not already installed.

2. After completing workflow changes, remove the extension as there is some noise created by it (it's polluting the problems view).
