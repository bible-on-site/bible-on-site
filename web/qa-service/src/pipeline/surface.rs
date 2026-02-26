//! SURFACE: Format answers with citations (plan Section 2 response shape).

use serde::Serialize;

use crate::pipeline::ingest::Chunk;

#[derive(Debug, Serialize)]
pub struct AnswerSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub name: String,
    pub author: String,
    #[serde(rename = "perekId")]
    pub perek_id: i32,
    /// For articles — the numeric id used in `/929/{perekId}/{articleId}`.
    #[serde(rename = "articleId", skip_serializing_if = "Option::is_none")]
    pub article_id: Option<i32>,
    /// For perushim — the perush name used as slug in `/929/{perekId}/{perushName}`.
    #[serde(rename = "perushSlug", skip_serializing_if = "Option::is_none")]
    pub perush_slug: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Answer {
    pub text: String,
    pub confidence: f64,
    pub source: AnswerSource,
    pub context: String,
}

#[derive(Debug, Serialize)]
pub struct AskResponse {
    pub answers: Vec<Answer>,
    #[serde(rename = "noAnswer")]
    pub no_answer: bool,
}

pub fn chunk_to_answer(c: &Chunk, confidence: f64) -> Answer {
    let name = c
        .article_name
        .clone()
        .or(c.perush_name.clone())
        .unwrap_or_default();
    Answer {
        text: c.text.clone(),
        confidence,
        source: AnswerSource {
            source_type: c.source_type.clone(),
            name,
            author: c.author.clone(),
            perek_id: c.perek_id,
            article_id: c.article_id,
            perush_slug: c.perush_name.clone(),
        },
        context: c.text.clone(),
    }
}
