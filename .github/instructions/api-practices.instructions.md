---
description: "Rust GraphQL API development and testing practices for web/api"
applyTo: "web/api/**"
---

# API (web/api) Practices

## Legacy Reference

When asked to **inspire from legacy API** or reference the old API implementation, look at the `legacy-api/` directory in the repo root. This is an untracked directory containing the previous API codebase for reference.

## Development

Use **cargo-make** (`Makefile.toml`):

| Task | Command |
| ---- | ------- |
| Run API | `cargo make run-api` |
| E2E Tests | `cargo make test-e2e` |
| E2E Coverage | `cargo make coverage-e2e` |
| Lint | `cargo make lint` |
| Clean | `cargo make clean` |
| Build Docker | `cargo make package` |

## Testing

- E2E in `tests/e2e/` with Playwright. Use `DB_URL` or `.test.env`.
- Populate test DB: `cd data && DB_URL="mysql://root:test_123@localhost:3306/tanah_test" cargo make mysql-populate`
- MySQL CLI: `mysql -u root -ptest_123 tanah_test`

### Authenticated Recovery APIs

- Revision/family management auth fails closed when its environment key is missing or blank. Test missing, wrong, and correct bearer tokens at the GraphQL schema boundary.
- Use caller-supplied stable IDs for idempotent recovery puts and expose lossless reads for all fields those puts accept. Validate a put, read-back equality, and a second identical put.
- Resolve lookup names in batches outside relationship loops. SeaORM mock tests must contain exactly the query results production consumes; unused appended results hide query-count regressions.
- Before diagnosing a production database mismatch, compare a known stable ID through the API with the same entity rendered by the website. Exact-name searches alone are not a sufficient discriminator.
- On Windows or Git Bash, pipe non-ASCII JSON to native `curl --data-binary @-`; command-line arguments can corrupt Hebrew while still producing valid JSON. Verify returned UTF-8 bytes before issuing dependent writes.
- Read fixture identity semantics literally. A focal person selected by query must be resolved to the entry-linked production person; fixed support IDs do not imply that the focal person should receive a new fixed ID.
- Keep recovery deletes narrowly guarded. Lock the target rows, require exact entity/person/metadata IDs, and reject deletion while any entry association or foreign-key-backed person reference remains. Audit every `REFERENCES tanahpedia_person` constraint in the canonical schema rather than relying only on website family tables.
- Check `/health` for the deployed package version before calling a newly merged mutation. ECS can deploy new secrets on an older image successfully.
- Do not assume `.env` overrides production configuration without inspecting the release image. The current API Dockerfile excludes `.env` and copies only the compiled binary into the final stage.

## Structure

- Entities: `entities/`; Services: `src/services/`; Resolvers: `src/resolvers/`; DTOs: `src/dtos/`.
