---
description: "Rust GraphQL API development and testing practices for web/api"
applyTo: "web/api/**"
---

# API (web/api) Practices

## Legacy Reference

"Inspire from legacy API" = the untracked `legacy-api/` directory in the repo root.

## Development (cargo-make)

| Task | Command |
| ---- | ------- |
| Run API | `cargo make run-api` |
| E2E Tests | `cargo make test-e2e` |
| E2E Coverage | `cargo make coverage-e2e` |
| Lint | `cargo make lint` |
| Clean | `cargo make clean` |
| Build Docker | `cargo make package` |

## Testing

- Playwright e2e in `tests/e2e/`, using `DB_URL` or `.test.env`.
- Populate: `cd data && DB_URL="mysql://root:test_123@localhost:3306/tanah_test" cargo make mysql-populate`; inspect with `mysql -u root -ptest_123 tanah_test`.

### Authenticated Recovery APIs

- Auth fails closed when its environment key is missing or blank — test missing, wrong, and correct bearer tokens at the GraphQL schema boundary.
- Recovery puts are idempotent by caller-supplied stable ID and reads must be lossless for every field those puts accept: validate a put, a read-back comparison, and a second identical put.
- Resolve lookup names in batches outside relationship loops. SeaORM mock tests must contain exactly the query results production consumes; unused appended results hide query-count regressions.
- Keep deletes narrowly guarded: lock the target rows, require exact entity/person/metadata IDs, and refuse while any entry association or foreign-key person reference remains. Audit every `REFERENCES tanahpedia_person` constraint in the canonical schema, not just website family tables.
- Before diagnosing a production mismatch, compare a known stable ID through the API against the same entity rendered by the website; exact-name searches are not a sufficient discriminator.
- On Windows/Git Bash, pipe non-ASCII JSON to native `curl --data-binary @-` — argv can corrupt Hebrew while still producing valid JSON. Verify returned UTF-8 bytes before dependent writes.
- Read fixture identity semantics literally: a focal person selected by query resolves to the entry-linked production person; fixed support IDs do not imply a new fixed focal ID.
- Check `/health` for the deployed package version before calling a newly merged mutation — ECS can deploy new secrets on an older image.
- Do not assume `.env` overrides production configuration: the API Dockerfile excludes `.env` and copies only the compiled binary into the final stage.

## Structure

Entities `entities/`; services `src/services/`; resolvers `src/resolvers/`; DTOs `src/dtos/`.
