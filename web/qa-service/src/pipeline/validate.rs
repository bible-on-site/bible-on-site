//! VALIDATE: Filter and deduplicate reasoned answers.

use crate::pipeline::reason::ReasonedAnswer;

pub struct ValidatedAnswer {
    pub answer: ReasonedAnswer,
    /// Combined score: QA confidence * retrieval similarity.
    pub combined_score: f64,
}

const MIN_QA_CONFIDENCE: f64 = 0.01;
const MIN_SPAN_CHARS: usize = 2;
const MAX_SPAN_CHARS: usize = 2000;

/// Validate and rank reasoned answers. Filters by confidence, span length,
/// and deduplicates near-identical spans.
pub fn validate(mut answers: Vec<ReasonedAnswer>, top_k: usize) -> Vec<ValidatedAnswer> {
    // Filter by confidence and span length
    answers.retain(|a| {
        a.span.confidence >= MIN_QA_CONFIDENCE
            && a.span.text.chars().count() >= MIN_SPAN_CHARS
            && a.span.text.chars().count() <= MAX_SPAN_CHARS
    });

    // Score: geometric mean of QA confidence and retrieval similarity
    let mut validated: Vec<ValidatedAnswer> = answers
        .into_iter()
        .map(|a| {
            let combined = (a.span.confidence * a.retrieval_score).sqrt();
            ValidatedAnswer {
                answer: a,
                combined_score: combined,
            }
        })
        .collect();

    // Sort by combined score descending
    validated.sort_by(|a, b| {
        b.combined_score
            .partial_cmp(&a.combined_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Deduplicate: remove answers whose span text is a substring of a higher-scored answer
    let mut deduped: Vec<ValidatedAnswer> = Vec::new();
    for v in validated {
        let dominated = deduped.iter().any(|existing| {
            let existing_text = &existing.answer.span.text;
            let new_text = &v.answer.span.text;
            existing_text.contains(new_text.as_str()) || new_text.contains(existing_text.as_str())
        });
        if !dominated {
            deduped.push(v);
        }
    }

    deduped.truncate(top_k);
    deduped
}
