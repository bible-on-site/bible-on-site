//! POST /ask — full RAG pipeline: Embed → Retrieve → Reason → Validate → Surface.

use actix_web::web::{Data, Json};
use ndarray::Array2;
use serde::Deserialize;
use tracing::{debug, info};

use crate::models::embedder::Embedder;
use crate::models::qa_model::QaModel;
use crate::pipeline::ingest::Chunk;
use crate::pipeline::{reason, retrieve, surface, validate};

#[derive(Debug, Deserialize)]
pub struct AskBody {
    pub question: String,
    #[serde(rename = "perekIds")]
    pub perek_ids: Option<Vec<i32>>,
}

const MAX_RETRIEVE: usize = 16;
const MAX_ANSWERS: usize = 8;
const MIN_RETRIEVAL_SCORE: f32 = 0.3;

pub async fn ask(
    chunks: Data<Vec<Chunk>>,
    embeddings: Data<Array2<f32>>,
    embedder: Data<Embedder>,
    qa_model: Data<QaModel>,
    body: Json<AskBody>,
) -> actix_web::HttpResponse {
    let q = body.question.trim();
    info!(question = q, perek_ids = ?body.perek_ids, total_chunks = chunks.len(), "ASK");

    // 1. Embed the query
    let query_vec = match embedder.embed_query(q) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "Failed to embed query");
            return actix_web::HttpResponse::InternalServerError()
                .json(serde_json::json!({"error": "embedding failed"}));
        }
    };

    // 2. RETRIEVE: cosine similarity
    let ids = body.perek_ids.as_deref();
    let retrieved = retrieve::retrieve(
        chunks.get_ref(),
        embeddings.get_ref(),
        &query_vec,
        ids,
        MAX_RETRIEVE,
        MIN_RETRIEVAL_SCORE,
    );
    if !retrieved.is_empty() {
        let top_scores: Vec<f64> = retrieved.iter().take(5).map(|sc| sc.score).collect();
        info!(count = retrieved.len(), ?top_scores, "RETRIEVE results");
    } else {
        info!("RETRIEVE: 0 results");
    }

    if retrieved.is_empty() {
        return actix_web::HttpResponse::Ok()
            .json(surface::AskResponse { answers: vec![], no_answer: true });
    }

    // 3. REASON: extractive QA on each retrieved chunk
    let chunk_scores: Vec<(Chunk, f64)> = retrieved
        .iter()
        .map(|sc| (sc.chunk.clone(), sc.score))
        .collect();
    let reasoned = reason::reason(qa_model.get_ref(), q, &chunk_scores);
    info!(reasoned = reasoned.len(), "REASON results");

    // 4. VALIDATE: confidence threshold + dedup
    let validated = validate::validate(reasoned, MAX_ANSWERS);
    debug!(validated = validated.len(), "VALIDATE results");

    // 5. SURFACE: format response
    let response = surface::surface(&validated);
    info!(answers = response.answers.len(), no_answer = response.no_answer, "ASK response");

    actix_web::HttpResponse::Ok().json(response)
}
