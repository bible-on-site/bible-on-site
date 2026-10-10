//! REASON: Run extractive QA model on retrieved chunks to extract answer spans.

use crate::models::qa_model::{QaModel, QaSpan};
use crate::pipeline::ingest::Chunk;

/// A chunk with an extracted answer span from the QA model.
#[derive(Debug, Clone)]
pub struct ReasonedAnswer {
    pub chunk: Chunk,
    /// The extracted answer span text.
    pub span: QaSpan,
    /// The retrieval similarity score (from RETRIEVE).
    pub retrieval_score: f64,
}

/// For each retrieved chunk, run the QA model to extract the best answer span.
/// Chunks where the model finds no answer are dropped.
pub fn reason(
    qa_model: &QaModel,
    question: &str,
    scored_chunks: &[(Chunk, f64)],
) -> Vec<ReasonedAnswer> {
    scored_chunks
        .iter()
        .enumerate()
        .filter_map(|(i, (chunk, retrieval_score))| {
            match qa_model.extract(question, &chunk.text) {
                Ok(Some(span)) => {
                    tracing::info!(i, confidence = span.confidence, span_len = span.text.len(), "REASON: extracted span");
                    Some(ReasonedAnswer {
                        chunk: chunk.clone(),
                        span,
                        retrieval_score: *retrieval_score,
                    })
                },
                Ok(None) => {
                    tracing::debug!(i, "REASON: no answer from QA model");
                    None
                }
                Err(e) => {
                    tracing::warn!(i, error = %e, "REASON: QA model error");
                    None
                }
            }
        })
        .collect()
}
