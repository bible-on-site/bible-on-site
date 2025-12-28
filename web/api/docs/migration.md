# Legacy API Migration

This document tracks the migration of GraphQL APIs from `legacy-api/` (TypeScript/Node.js) to `web/api/` (Rust/async-graphql).

## Migration Status

| API | Legacy Location | Status | Notes |
|-----|----------------|--------|-------|
| Author | `legacy-api/api/resolvers/author-resolver.ts` | ✅ Migrated | `authorById` query |
| Sefer | `legacy-api/dal/sefer-data-source.ts` | ✅ Migrated | `seferById`, `sefarim` queries |
| Article | `legacy-api/api/resolvers/article-reslover.ts` | ✅ Migrated | `articleById`, `articlesByPerekId`, `articlesByAuthorId` queries |
| Perek | `legacy-api/api/resolvers/perek-resolver.ts` | ✅ Migrated | `perekByPerekId`, `perakim`, `perakimBySeferId` queries |
| Starter | `legacy-api/api/resolvers/starter-resolver.ts` | 🔄 Pending | Aggregation: authors list + perek article counters |

## Database Schema Reference

### Tables

| Table | Description | Key Fields |
|-------|-------------|------------|
| `tanah_rabbi` | Authors/Rabbis | `ID`, `NAME`, `DETAILS`, `ARTICLE_DETECTION_TYPE_ID` |
| `tanah_sefer` | Books of Tanah | `SEFER_ID`, `NAME`, `TANACH_US_NAME` |
| `tanah_article` | Articles | `ID`, `PEREK_ID`, `AUTHOR_ID`, `ABSTRACT`, `NAME`, `PRIORITY` |
| `tanah_perek` | Perakim (chapters) | `ID`, `PEREK_ID`, `SEFER_ID`, `ADDITIONAL`, `PEREK`, `DATE`, `HEBDATE`, `TSEIT`, `HEADER`, `SOURCE` |
| `tanah_system_message` | System messages | `ID`, `PRIORITY`, `ABSTRACT`, `CONTENT`, `ACTIVE` |

### Special Notes

- **Additionals**: שמואל, מלכים, דברי הימים use `ADDITIONAL` field with values 1, 2. עזרא uses 70, 50.
- **tanachUsName**: Can be a simple string ("Gen") or JSON object (`{"1":"1 Sam","2":"2 Sam"}`) for sefarim with additionals.

## Migration Pattern

Each API migration follows this structure:

```
web/api/
├── entities/src/{entity}.rs     # SeaORM entity (database model)
├── src/dtos/{entity}.rs          # GraphQL DTO (output type)
├── src/services/{entity}_service.rs  # Business logic
├── src/resolvers/{entity}_resolver.rs # GraphQL queries/mutations
└── tests/e2e/{entity}-service.test.ts # Playwright E2E tests
```

### Steps to migrate an API:

1. **Create Entity** (`entities/src/{entity}.rs`):
   - Define the SeaORM model with `#[derive(DeriveEntityModel)]`
   - Map column names with `#[sea_orm(column_name = "...")]`
   - Export in `entities/src/lib.rs`

2. **Create DTO** (`src/dtos/{entity}.rs`):
   - Define the GraphQL output type with `#[derive(SimpleObject)]`
   - Implement `From<Model>` for conversion
   - Export in `src/dtos/mod.rs`

3. **Create Service** (`src/services/{entity}_service.rs`):
   - Implement `find_one_by_id`, `find_all`, etc.
   - Handle errors with `ServiceError`
   - Export in `src/services/mod.rs`

4. **Create Resolver** (`src/resolvers/{entity}_resolver.rs`):
   - Define GraphQL queries with `#[Object]`
   - Use service layer for data access
   - Export in `src/resolvers/mod.rs`
   - Register in `src/startup/schema_builder.rs`

5. **Update Test Data**:
   - Add table structure to `devops/tanah_test_structure.sql`
   - Add test data to `devops/tanah_test_data.sql`
   - Repopulate with: `DB_URL="mysql://root:test_123@localhost:3306/tanah_test" npx tsx devops/populate-test-db.mts`

6. **Write E2E Tests** (`tests/e2e/{entity}-service.test.ts`):
   - Test happy path queries
   - Test error cases (not found, etc.)
   - Run with: `cargo make test-e2e`

## Running the API

```bash
cd web/api
cargo make run-api      # Run the server
cargo make test-e2e     # Run E2E tests
cargo make lint         # Run Clippy
```
