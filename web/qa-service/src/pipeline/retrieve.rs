//! RETRIEVE: Filter by perekIds and rank by keyword match (simple RAG).
//! Chunks with zero matching terms are excluded to avoid noise.

use crate::pipeline::ingest::Chunk;

/// Split Hebrew/mixed question into tokens. Skip single-char tokens (prefixes like ב, ה, ו).
fn tokenize(question: &str) -> Vec<String> {
    question
        .split(|c: char| c.is_whitespace() || c.is_ascii_punctuation() || c == '?' || c == '״' || c == '"')
        .map(|s| s.trim())
        .filter(|s| s.chars().count() > 1)
        .map(|s| s.to_string())
        .collect()
}

fn score_chunk(chunk: &Chunk, terms: &[String]) -> usize {
    terms
        .iter()
        .filter(|t| chunk.text.contains(t.as_str()))
        .count()
}

/// A chunk together with its keyword-match score (matched_terms / total_terms).
pub struct ScoredChunk {
    pub chunk: Chunk,
    /// 0.0–1.0 ratio of query terms found in this chunk's text.
    pub score: f64,
}

/// Retrieve chunks filtered by optional set of perekIds, ranked by keyword match; returns top K.
/// When `perek_ids` is None, all chunks are searched (כל התנ"ך).
/// Zero-score chunks are excluded so only relevant results appear.
pub fn retrieve(chunks: &[Chunk], perek_ids: Option<&[i32]>, question: &str, top_k: usize) -> Vec<ScoredChunk> {
    let filtered: Vec<&Chunk> = match perek_ids {
        None => chunks.iter().collect(),
        Some(ids) => chunks.iter().filter(|c| ids.contains(&c.perek_id)).collect(),
    };
    let terms = tokenize(question);
    if terms.is_empty() {
        return filtered
            .into_iter()
            .take(top_k)
            .map(|c| ScoredChunk { chunk: c.clone(), score: 0.0 })
            .collect();
    }
    let total = terms.len() as f64;
    let mut scored: Vec<(usize, &Chunk)> = filtered
        .into_iter()
        .map(|c| (score_chunk(c, &terms), c))
        .filter(|(score, _)| *score > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored
        .into_iter()
        .take(top_k)
        .map(|(raw, c)| ScoredChunk {
            chunk: c.clone(),
            score: raw as f64 / total,
        })
        .collect()
}
