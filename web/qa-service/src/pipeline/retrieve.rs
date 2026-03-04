//! RETRIEVE: Semantic retrieval via cosine similarity over embeddings.
//! Replaces the Phase 0 keyword-match retriever.

use ndarray::{Array1, Array2};

use crate::pipeline::ingest::Chunk;

/// A retrieved chunk with its cosine similarity score.
pub struct ScoredChunk {
    pub chunk: Chunk,
    /// Cosine similarity between query embedding and chunk embedding (0.0–1.0 after normalization).
    pub score: f64,
}

/// Retrieve top-K chunks by cosine similarity of query embedding vs chunk embeddings.
/// Optionally filter by `perek_ids`.
pub fn retrieve(
    chunks: &[Chunk],
    embeddings: &Array2<f32>,
    query_embedding: &Array1<f32>,
    perek_ids: Option<&[i32]>,
    top_k: usize,
    min_score: f32,
) -> Vec<ScoredChunk> {
    // Compute cosine similarity: since embeddings are L2-normalized, dot product = cosine sim
    let similarities = embeddings.dot(query_embedding);

    let mut scored: Vec<(usize, f32)> = similarities
        .iter()
        .enumerate()
        .filter(|(_, sim)| **sim >= min_score)
        .filter(|(idx, _)| match perek_ids {
            None => true,
            Some(ids) => ids.contains(&chunks[*idx].perek_id),
        })
        .map(|(idx, sim)| (idx, *sim))
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    scored
        .into_iter()
        .take(top_k)
        .map(|(idx, sim)| ScoredChunk {
            chunk: chunks[idx].clone(),
            score: sim as f64,
        })
        .collect()
}
