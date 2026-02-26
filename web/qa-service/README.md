# QA Service (Tanah RAG)

Rust Actix-Web service for RAG over perushim (Malbim + Or HaChaim) and articles (e.g. הרב איתן שנדורפי). **Phase 0:** MySQL → in-memory chunks, keyword retrieval, no vector DB or ONNX.

See [docs/bot_on_site/integration-plan.md](../../docs/bot_on_site/integration-plan.md).

## Run locally

1. MySQL with perushim data (`note` / `perush` / `parshan`) and articles (`tanah_article` / `tanah_author`), e.g. `tanah-dev`.
2. From repo root:

   ```bash
   cd web/qa-service
   export DB_URL="mysql://root:test_123@127.0.0.1:3306/tanah-dev"
   cargo run
   ```

   Or use `.dev.env` (service reads `DB_URL` and `QA_BIND`, default `127.0.0.1:3004`).

3. Endpoints:
   - `GET /health/ready` — readiness
   - `POST /ask` — body `{ "question": "...", "perekId": optional number }`; returns `{ "answers": [...], "noAnswer": bool }`

## Phase 0 behaviour

- **INGEST:** Malbim and Or HaChaim notes from MySQL (`note` ↔ `perush` ↔ `parshan`, filter by parshan name); articles from `tanah_article` JOIN `tanah_author` (filter author name containing "שנדורפי"). Article content/abstract stripped of HTML and split into chunks.
- **RETRIEVE:** Keyword match (question terms in chunk text) + optional `perekId` filter; ranked by match count, top 8 returned.
- **SURFACE:** JSON with `answers[].text`, `source.type` (article | perush), `source.name`, `source.author`, `source.perekId`.
