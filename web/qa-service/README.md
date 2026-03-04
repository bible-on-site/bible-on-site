# QA Service (Tanah RAG)

Rust Actix-Web service for RAG over perushim (Malbim + Or HaChaim) and articles. **Week 2:** Semantic retrieval (multilingual-e5-small) + extractive QA (XLM-RoBERTa-squad2), both via ONNX Runtime.

See [docs/bot_on_site/integration-plan.md](../../docs/bot_on_site/integration-plan.md).

## Setup

### 1. Download ONNX models

```bash
# Option A: Direct download (no Python needed)
bash scripts/download-models-direct.sh

# Option B: Using Python + optimum
pip install -r scripts/requirements.txt
python scripts/download-models.py
```

Models are saved to `models/embedder/` and `models/qa/` (~1.5 GB total).

### 2. Run locally

```bash
cd web/qa-service
export DB_URL="mysql://root:test_123@127.0.0.1:3306/tanah-dev"
cargo run
```

Or use `.dev.env` (reads `DB_URL`, `QA_BIND` default `127.0.0.1:3004`, `MODELS_DIR` default `models`).

First startup embeds all ~37K chunks (takes ~30 min on CPU). Embeddings are cached to `models/embeddings_cache.bin` — subsequent starts load in seconds.

### 3. Endpoints

- `GET /health/ready` — readiness
- `POST /ask` — `{ "question": "...", "perekIds": [optional array] }`
  - Returns `{ "answers": [...], "noAnswer": bool }`
  - Each answer has: `text` (extracted span), `confidence` (0.0–1.0), `source`, `context`
- `GET /debug/stats` — loaded chunk counts

## Pipeline

1. **INGEST:** Load Malbim + Or HaChaim perush notes and all articles from MySQL. Strip HTML, split into paragraph chunks.
2. **RETRIEVE:** Embed query with MiniLM E5, compute cosine similarity against pre-computed chunk embeddings, return top-K.
3. **REASON:** Run XLM-RoBERTa extractive QA on each retrieved chunk to extract answer spans.
4. **VALIDATE:** Filter by confidence, deduplicate overlapping spans, combine retrieval + QA scores.
5. **SURFACE:** Format JSON response with citations.
