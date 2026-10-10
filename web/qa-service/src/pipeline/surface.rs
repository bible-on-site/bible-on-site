//! SURFACE: Format validated answers with citations and extracted spans.

use serde::Serialize;

use crate::pipeline::ingest::Chunk;
use crate::pipeline::validate::ValidatedAnswer;

#[derive(Debug, Serialize)]
pub struct AnswerSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub name: String,
    pub author: String,
    #[serde(rename = "perekId")]
    pub perek_id: i32,
    #[serde(rename = "articleId", skip_serializing_if = "Option::is_none")]
    pub article_id: Option<i32>,
    #[serde(rename = "perushSlug", skip_serializing_if = "Option::is_none")]
    pub perush_slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pasuk: Option<i16>,
    #[serde(rename = "noteIdx", skip_serializing_if = "Option::is_none")]
    pub note_idx: Option<i16>,
}

#[derive(Debug, Serialize)]
pub struct Answer {
    /// The extracted answer span (verbatim from source).
    pub text: String,
    /// Model confidence (0.0–1.0).
    pub confidence: f64,
    pub source: AnswerSource,
    /// Surrounding context for readability.
    pub context: String,
}

#[derive(Debug, Serialize)]
pub struct AskResponse {
    pub answers: Vec<Answer>,
    #[serde(rename = "noAnswer")]
    pub no_answer: bool,
}

fn source_from_chunk(c: &Chunk) -> AnswerSource {
    let name = c.article_name.clone()
        .or(c.perush_name.clone())
        .unwrap_or_default();
    AnswerSource {
        source_type: c.source_type.clone(),
        name,
        author: c.author.clone(),
        perek_id: c.perek_id,
        article_id: c.article_id,
        perush_slug: c.perush_name.clone(),
        pasuk: c.pasuk,
        note_idx: c.note_idx,
    }
}

pub fn surface(validated: &[ValidatedAnswer]) -> AskResponse {
    let answers: Vec<Answer> = validated
        .iter()
        .map(|v| {
            let a = &v.answer;
            Answer {
                text: a.span.text.clone(),
                confidence: v.combined_score,
                source: source_from_chunk(&a.chunk),
                context: a.chunk.text.clone(),
            }
        })
        .collect();

    let no_answer = answers.is_empty();
    AskResponse { answers, no_answer }
}

/// Fallback: format a chunk directly as an answer (used when QA model is unavailable).
pub fn chunk_to_answer(c: &Chunk, confidence: f64) -> Answer {
    Answer {
        text: c.text.clone(),
        confidence,
        source: source_from_chunk(c),
        context: c.text.clone(),
    }
}
