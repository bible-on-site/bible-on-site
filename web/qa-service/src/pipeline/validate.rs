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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::qa_model::QaSpan;
    use crate::pipeline::ingest::Chunk;

    fn chunk(text: &str) -> Chunk {
        Chunk {
            source_type: "perush".into(),
            perek_id: 1,
            text: text.into(),
            author: "a".into(),
            perush_id: None,
            perush_name: None,
            pasuk: None,
            note_idx: None,
            article_id: None,
            article_name: None,
        }
    }

    fn answer(text: &str, confidence: f64, retrieval: f64) -> ReasonedAnswer {
        ReasonedAnswer {
            chunk: chunk(text),
            span: QaSpan {
                text: text.into(),
                confidence,
            },
            retrieval_score: retrieval,
        }
    }

    #[test]
    fn drops_low_confidence_spans() {
        let v = validate(vec![answer("some text", 0.005, 1.0)], 10);
        assert!(v.is_empty());
    }

    #[test]
    fn drops_too_short_and_too_long_spans() {
        let short = answer("x", 0.9, 1.0);
        let long = answer(&"y".repeat(2001), 0.9, 1.0);
        assert!(validate(vec![short, long], 10).is_empty());
    }

    #[test]
    fn ranks_by_geometric_mean_of_confidence_and_retrieval() {
        // conf 0.81 * retr 1.0 → 0.9 beats conf 1.0 * retr 0.64 → 0.8
        let weaker = answer("weak", 1.0, 0.64);
        let stronger = answer("strong", 0.81, 1.0);
        let v = validate(vec![weaker, stronger], 10);
        assert_eq!(v[0].answer.span.text, "strong");
        assert!((v[0].combined_score - 0.9).abs() < 1e-9);
    }

    #[test]
    fn dedupes_substring_overlapping_spans_keeping_higher_score() {
        let big = answer("the complete answer text", 0.9, 1.0);
        let small = answer("complete answer", 0.8, 1.0);
        let other = answer("unrelated span", 0.5, 1.0);
        let v = validate(vec![big, small, other], 10);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].answer.span.text, "the complete answer text");
        assert_eq!(v[1].answer.span.text, "unrelated span");
    }

    #[test]
    fn truncates_to_top_k_after_dedup() {
        let answers: Vec<ReasonedAnswer> = (0..5)
            .map(|i| answer(&format!("answer {i}"), 1.0 - i as f64 * 0.1, 1.0))
            .collect();
        let v = validate(answers, 2);
        assert_eq!(v.len(), 2);
    }
}
