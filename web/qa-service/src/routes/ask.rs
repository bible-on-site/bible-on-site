//! POST /ask — RAG over perushim + articles (keyword retrieval, Phase 0).

use actix_web::web::{Data, Json};
use serde::Deserialize;
use tracing::{debug, info};

use crate::pipeline::ingest::Chunk;
use crate::pipeline::retrieve;
use crate::pipeline::surface::{chunk_to_answer, AskResponse};

#[derive(Debug, Deserialize)]
pub struct AskBody {
    pub question: String,
    #[serde(rename = "perekIds")]
    pub perek_ids: Option<Vec<i32>>,
}

const MAX_ANSWERS: usize = 8;

pub async fn ask(chunks: Data<Vec<Chunk>>, body: Json<AskBody>) -> actix_web::HttpResponse {
    let q = body.question.trim();
    info!(
        question = q,
        perek_ids = ?body.perek_ids,
        total_chunks = chunks.len(),
        "ASK"
    );

    let ids = body.perek_ids.as_deref();
    let perek_chunks = match ids {
        Some(ids) => chunks.iter().filter(|c| ids.contains(&c.perek_id)).count(),
        None => chunks.len(),
    };
    debug!(perek_chunks, "chunks after perekIds filter");

    let results = retrieve::retrieve(chunks.get_ref(), ids, q, MAX_ANSWERS);
    debug!(matched = results.len(), "retrieve results");

    let answers: Vec<_> = results
        .iter()
        .map(|sc| chunk_to_answer(&sc.chunk, sc.score))
        .collect();
    let no_answer = answers.is_empty();
    info!(
        answers = answers.len(),
        no_answer,
        "ASK response"
    );
    actix_web::HttpResponse::Ok().json(AskResponse { answers, no_answer })
}
