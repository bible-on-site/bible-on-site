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

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::arr2;

    fn chunk(perek_id: i32, text: &str) -> Chunk {
        Chunk {
            source_type: "perush".into(),
            perek_id,
            text: text.into(),
            author: "author".into(),
            perush_id: None,
            perush_name: None,
            pasuk: None,
            note_idx: None,
            article_id: None,
            article_name: None,
        }
    }

    #[test]
    fn ranks_by_cosine_similarity() {
        let chunks = vec![chunk(1, "low"), chunk(1, "mid"), chunk(1, "high")];
        // L2-normalized rows → dot product equals cosine similarity.
        let embeddings = arr2(&[
            [0.0f32, 1.0], // orthogonal to query
            [
                std::f32::consts::FRAC_1_SQRT_2,
                std::f32::consts::FRAC_1_SQRT_2,
            ],
            [1.0, 0.0], // identical to query
        ]);
        let query = ndarray::arr1(&[1.0f32, 0.0]);

        let hits = retrieve(&chunks, &embeddings, &query, None, 10, 0.0);

        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].chunk.text, "high");
        assert!((hits[0].score - 1.0).abs() < 1e-5);
        assert_eq!(hits[1].chunk.text, "mid");
        assert_eq!(hits[2].chunk.text, "low");
        assert_eq!(hits[2].score, 0.0);
    }

    #[test]
    fn filters_below_min_score() {
        let chunks = vec![chunk(1, "a"), chunk(1, "b")];
        let embeddings = arr2(&[[1.0f32, 0.0], [0.5, 0.8660254]]);
        let query = ndarray::arr1(&[1.0f32, 0.0]);

        let hits = retrieve(&chunks, &embeddings, &query, None, 10, 0.6);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk.text, "a");
    }

    #[test]
    fn filters_by_perek_ids_when_given() {
        let chunks = vec![chunk(1, "wrong"), chunk(7, "right"), chunk(3, "wrong2")];
        let embeddings = arr2(&[[1.0f32], [1.0], [1.0]]);
        let query = ndarray::arr1(&[1.0f32]);

        let hits = retrieve(&chunks, &embeddings, &query, Some(&[7]), 10, 0.0);

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk.perek_id, 7);
    }

    #[test]
    fn truncates_to_top_k() {
        let chunks = vec![chunk(1, "a"), chunk(1, "b"), chunk(1, "c")];
        let embeddings = arr2(&[[0.9f32], [0.8], [1.0]]);
        let query = ndarray::arr1(&[1.0f32]);

        let hits = retrieve(&chunks, &embeddings, &query, None, 2, 0.0);

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].chunk.text, "c");
        assert_eq!(hits[1].chunk.text, "a");
    }

    #[test]
    fn returns_empty_when_nothing_passes() {
        let chunks = vec![chunk(1, "a")];
        let embeddings = arr2(&[[0.1f32]]);
        let query = ndarray::arr1(&[1.0f32]);

        let hits = retrieve(&chunks, &embeddings, &query, None, 10, 0.5);

        assert!(hits.is_empty());
    }
}
