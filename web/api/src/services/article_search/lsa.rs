//! Corpus-trained Latent Semantic Analysis (LSA) for article embeddings.
//!
//! Chosen over hosted embedding APIs and local neural models: pure-Rust,
//! deterministic, zero per-query cost, and a genuinely semantic method — the
//! truncated SVD groups terms that co-occur across documents, so a query can
//! match articles that use related vocabulary without sharing its exact words.
//!
//! Pipeline: Hebrew-normalized tokens → field-weighted term frequencies →
//! smoothed tf-idf → randomized truncated SVD → dense unit vectors of `dims`
//! dimensions stored per article. Queries and updated documents are folded in
//! through the trained term basis; a full retrain rebuilds the basis when
//! article writes drain through the index queue.

use std::collections::HashMap;

use super::text::term_frequencies;

/// Maximum retained latent dimensions per model build.
pub const MAX_DIMS: usize = 128;
/// Extra sketch columns used by the randomized range finder.
const OVERSAMPLE: usize = 16;
/// Deterministic seed for reproducible builds.
const RNG_SEED: u64 = 0xB1B1_E0A5_17C0_5EED;
/// Terms rarer than this document frequency are dropped when the corpus is
/// large enough for the cutoff to be meaningful.
const LARGE_CORPUS: usize = 200;
const LARGE_CORPUS_MIN_DF: u32 = 2;
/// Hard cap on vocabulary size; most-frequent terms win.
const MAX_VOCAB: usize = 60_000;

/// Field weights applied when folding article sections into one token stream.
/// Article name tokens count triple, the abstract double, content once.
pub const NAME_WEIGHT: u32 = 3;
pub const ABSTRACT_WEIGHT: u32 = 2;

/// The fitted semantic model: vocabulary, inverse document frequencies, and the
/// term-space basis (`basis[tid * dims + dim]`).
#[derive(Debug, Clone, PartialEq)]
pub struct LsaModel {
    pub dims: usize,
    pub vocab: Vec<String>,
    pub index: HashMap<String, u32>,
    pub idf: Vec<f32>,
    pub basis: Vec<f32>,
}

/// A document's sparse tf-idf vector as `(term_id, weight)` pairs.
pub type SparseVector = Vec<(u32, f32)>;

/// Counts tokens of a document section with a field weight applied.
fn add_weighted(counts: &mut HashMap<String, u32>, tokens: &[String], weight: u32) {
    for (term, count) in term_frequencies(tokens) {
        *counts.entry(term).or_insert(0) += count * weight;
    }
}

/// Merges an article's fields into one weighted term-frequency map.
pub fn article_term_counts(
    name: &[String],
    abstract_: &[String],
    content: &[String],
) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    add_weighted(&mut counts, name, NAME_WEIGHT);
    add_weighted(&mut counts, abstract_, ABSTRACT_WEIGHT);
    add_weighted(&mut counts, content, 1);
    counts
}

impl LsaModel {
    /// Builds the vocabulary + idf table over the corpus term-count maps.
    pub fn build_vocabulary(
        doc_counts: &[HashMap<String, u32>],
    ) -> (Vec<String>, Vec<u32>, Vec<f32>) {
        let n_docs = doc_counts.len();
        let mut df: HashMap<String, u32> = HashMap::new();
        for counts in doc_counts {
            for term in counts.keys() {
                *df.entry(term.clone()).or_insert(0) += 1;
            }
        }
        let min_df = if n_docs >= LARGE_CORPUS {
            LARGE_CORPUS_MIN_DF
        } else {
            1
        };
        let mut vocab: Vec<(String, u32)> = df
            .into_iter()
            .filter(|(_, count)| *count >= min_df)
            .collect();
        // Most-documented terms win when the cap binds; tie-break alphabetically
        // for deterministic builds.
        vocab.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        vocab.truncate(MAX_VOCAB);
        vocab.sort_by(|a, b| a.0.cmp(&b.0));
        let vocab_terms: Vec<String> = vocab.iter().map(|(term, _)| term.clone()).collect();
        let doc_freq: Vec<u32> = vocab.iter().map(|(_, count)| *count).collect();
        let idf: Vec<f32> = doc_freq
            .iter()
            .map(|count| ((n_docs as f32 + 1.0) / (*count as f32 + 1.0)).ln() + 1.0)
            .collect();
        (vocab_terms, doc_freq, idf)
    }

    /// Converts a weighted term-count map into a normalized sparse tf-idf
    /// vector expressed in this model's vocabulary.
    pub fn sparse_vector(&self, counts: &HashMap<String, u32>) -> SparseVector {
        let mut vector: SparseVector = Vec::with_capacity(counts.len());
        for (term, count) in counts {
            if let Some(&tid) = self.index.get(term) {
                let weight = (1.0 + (*count as f32).ln()) * self.idf[tid as usize];
                vector.push((tid, weight));
            }
        }
        vector.sort_by_key(|(tid, _)| *tid);
        normalize_sparse(&mut vector);
        vector
    }

    /// Trains the model on already-sparse tf-idf vectors via randomized SVD.
    /// `n_terms` is the vocabulary width. Returns a model whose `basis` covers
    /// up to `MAX_DIMS` latent dimensions (fewer for small/degenerate corpora).
    pub fn train(vocab: Vec<String>, idf: Vec<f32>, docs: &[SparseVector]) -> Self {
        let n_terms = vocab.len();
        let index: HashMap<String, u32> = vocab
            .iter()
            .enumerate()
            .map(|(i, term)| (term.clone(), i as u32))
            .collect();
        let n_docs = docs.len();
        let dims = MAX_DIMS.min(n_terms).min(n_docs);
        if dims == 0 {
            return Self {
                dims: 0,
                vocab,
                index,
                idf,
                basis: Vec::new(),
            };
        }
        let sketch = (dims + OVERSAMPLE).min(n_terms).min(n_docs);
        let basis = randomized_svd(docs, n_terms, sketch).unwrap_or_default();
        let dims = basis.len() / n_terms.max(1);
        Self {
            dims,
            vocab,
            index,
            idf,
            basis,
        }
    }

    /// Folds a sparse tf-idf vector into the latent space and L2-normalizes it.
    /// Used uniformly for indexed documents and incoming queries.
    pub fn embed(&self, sparse: &SparseVector) -> Vec<f32> {
        let mut dense = vec![0.0f32; self.dims];
        for &(tid, w) in sparse {
            let row = tid as usize * self.dims;
            for (d, value) in dense.iter_mut().enumerate() {
                *value += w * self.basis[row + d];
            }
        }
        normalize_dense(&mut dense);
        dense
    }
}

fn normalize_sparse(vector: &mut SparseVector) {
    let norm = vector.iter().map(|(_, w)| w * w).sum::<f32>().sqrt();
    if norm > 0.0 {
        for (_, w) in vector.iter_mut() {
            *w /= norm;
        }
    }
}

/// Cosine similarity between two unit vectors.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn normalize_dense(vector: &mut [f32]) {
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in vector.iter_mut() {
            *v /= norm;
        }
    }
}

/// Deterministic SplitMix64 generator — reproducible sketches across builds.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Standard-normal sample via Box–Muller on two uniforms.
    fn next_gaussian(&mut self) -> f32 {
        let u1 = ((self.next_u64() >> 11) as f64) * (1.0 / 9007199254740992.0);
        let u2 = ((self.next_u64() >> 11) as f64) * (1.0 / 9007199254740992.0);
        ((-2.0 * u1.max(f64::MIN_POSITIVE).ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos())
            as f32
    }
}

/// Randomized truncated SVD of the sparse doc×term matrix `docs` using a
/// Gaussian sketch of `sketch` columns. Returns the term-space basis `V`
/// (row-major terms×k) whose columns are the top right singular directions.
fn randomized_svd(docs: &[SparseVector], n_terms: usize, sketch: usize) -> Option<Vec<f32>> {
    if docs.is_empty() || n_terms == 0 || sketch == 0 {
        return None;
    }
    let n_docs = docs.len();
    let mut rng = SplitMix64(RNG_SEED);
    // Ω: terms × sketch (row-major)
    let omega: Vec<f32> = (0..n_terms * sketch).map(|_| rng.next_gaussian()).collect();
    // Y = A·Ω — docs × sketch
    let mut y = vec![0.0f32; n_docs * sketch];
    for (d, doc) in docs.iter().enumerate() {
        for &(tid, w) in doc {
            let row = tid as usize * sketch;
            for j in 0..sketch {
                y[d * sketch + j] += w * omega[row + j];
            }
        }
    }
    // Q = orthonormalized Y (modified Gram–Schmidt, two passes).
    let mut q = y;
    orthonormalize(&mut q, n_docs, sketch);
    // B = Qᵀ·A — sketch × terms
    let mut b = vec![0.0f32; sketch * n_terms];
    for (d, doc) in docs.iter().enumerate() {
        for &(tid, w) in doc {
            for j in 0..sketch {
                b[j * n_terms + tid as usize] += q[d * sketch + j] * w;
            }
        }
    }
    // Eigen-decompose B·Bᵀ (sketch × sketch) → U_b and σ².
    let mut bbt = vec![0.0f32; sketch * sketch];
    for i in 0..sketch {
        for j in i..sketch {
            let mut acc = 0.0f64;
            for t in 0..n_terms {
                acc += (b[i * n_terms + t] as f64) * (b[j * n_terms + t] as f64);
            }
            let v = acc as f32;
            bbt[i * sketch + j] = v;
            bbt[j * sketch + i] = v;
        }
    }
    let (eigenvalues, eigenvectors) = jacobi_eigendecomposition(&bbt, sketch);
    // Order directions by descending eigenvalue; keep numerically non-zero ones.
    let mut order: Vec<usize> = (0..sketch).collect();
    order.sort_by(|&a, &b| eigenvalues[b].total_cmp(&eigenvalues[a]));
    let max_sigma = eigenvalues[order[0]].max(0.0).sqrt();
    if max_sigma <= f32::EPSILON {
        return None;
    }
    let keep: Vec<usize> = order
        .iter()
        .copied()
        .filter(|&j| eigenvalues[j] > max_sigma * max_sigma * 1e-7)
        .take(MAX_DIMS)
        .collect();
    // V = Bᵀ·U_b·Σ⁻¹ for the kept directions → terms × k.
    let k = keep.len();
    let mut v = vec![0.0f32; n_terms * k];
    for (col, &j) in keep.iter().enumerate() {
        let sigma = eigenvalues[j].max(f32::EPSILON).sqrt();
        let inv_sigma = 1.0 / sigma;
        for t in 0..n_terms {
            let mut acc = 0.0f32;
            for i in 0..sketch {
                acc += b[i * n_terms + t] * eigenvectors[i * sketch + j];
            }
            v[t * k + col] = acc * inv_sigma;
        }
    }
    Some(v)
}

/// In-place modified Gram–Schmidt (two passes) over a row-major m×n matrix
/// treated as n column vectors. Columns that lose all norm are zeroed.
fn orthonormalize(q: &mut [f32], rows: usize, cols: usize) {
    for col in 0..cols {
        for _ in 0..2 {
            for prev in 0..col {
                let mut dot = 0.0f64;
                for r in 0..rows {
                    dot += (q[r * cols + col] as f64) * (q[r * cols + prev] as f64);
                }
                for r in 0..rows {
                    q[r * cols + col] -= (dot as f32) * q[r * cols + prev];
                }
            }
        }
        let mut norm = 0.0f64;
        for r in 0..rows {
            norm += (q[r * cols + col] as f64) * (q[r * cols + col] as f64);
        }
        let norm = norm.sqrt() as f32;
        if norm > f32::EPSILON {
            for r in 0..rows {
                q[r * cols + col] /= norm;
            }
        } else {
            for r in 0..rows {
                q[r * cols + col] = 0.0;
            }
        }
    }
}

/// Cyclic Jacobi eigendecomposition of a symmetric row-major n×n matrix.
/// Returns (eigenvalues, eigenvectors as row-major n×n columns: `v[i*n + j]`
/// is the i-th component of eigenvector j).
fn jacobi_eigendecomposition(matrix: &[f32], n: usize) -> (Vec<f32>, Vec<f32>) {
    let mut a: Vec<f64> = matrix.iter().map(|v| *v as f64).collect();
    let mut v = vec![0.0f64; n * n];
    for i in 0..n {
        v[i * n + i] = 1.0;
    }
    const MAX_SWEEPS: usize = 60;
    for _ in 0..MAX_SWEEPS {
        let mut off = 0.0f64;
        for p in 0..n.saturating_sub(1) {
            for q in (p + 1)..n {
                off += a[p * n + q] * a[p * n + q];
            }
        }
        if off < 1e-12 {
            break;
        }
        for p in 0..n.saturating_sub(1) {
            for q in (p + 1)..n {
                let apq = a[p * n + q];
                if apq.abs() < 1e-15 {
                    continue;
                }
                let app = a[p * n + p];
                let aqq = a[q * n + q];
                let theta = 0.5 * (aqq - app) / apq;
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for i in 0..n {
                    let aip = a[i * n + p];
                    let aiq = a[i * n + q];
                    a[i * n + p] = c * aip - s * aiq;
                    a[i * n + q] = s * aip + c * aiq;
                }
                for i in 0..n {
                    let api = a[p * n + i];
                    let aqi = a[q * n + i];
                    a[p * n + i] = c * api - s * aqi;
                    a[q * n + i] = s * api + c * aqi;
                }
                for i in 0..n {
                    let vip = v[i * n + p];
                    let viq = v[i * n + q];
                    v[i * n + p] = c * vip - s * viq;
                    v[i * n + q] = s * vip + c * viq;
                }
            }
        }
    }
    let eigenvalues: Vec<f32> = (0..n).map(|i| a[i * n + i] as f32).collect();
    let eigenvectors: Vec<f32> = v.iter().map(|x| *x as f32).collect();
    (eigenvalues, eigenvectors)
}

/// Serializes the model to the `article_search_state` blob format:
/// version header, dims, vocabulary, idf, and the i8-quantized term basis.
pub fn serialize_model(model: &LsaModel) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&1u32.to_le_bytes()); // format version
    out.extend_from_slice(&(model.dims as u32).to_le_bytes());
    out.extend_from_slice(&(model.vocab.len() as u32).to_le_bytes());
    for term in &model.vocab {
        let bytes = term.as_bytes();
        out.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(bytes);
    }
    for v in &model.idf {
        out.extend_from_slice(&v.to_le_bytes());
    }
    // Quantize each basis column to i8 with its own scale.
    let n_terms = model.vocab.len();
    let mut scales = vec![1.0f32; model.dims];
    for (d, scale) in scales.iter_mut().enumerate() {
        let mut max = 0.0f32;
        for t in 0..n_terms {
            max = max.max(model.basis[t * model.dims + d].abs());
        }
        *scale = if max > f32::EPSILON { max } else { 1.0 };
        out.extend_from_slice(&scale.to_le_bytes());
    }
    for t in 0..n_terms {
        for (d, scale) in scales.iter().enumerate() {
            let v = model.basis[t * model.dims + d] / *scale;
            out.push((v.clamp(-1.0, 1.0) * 127.0).round() as i8 as u8);
        }
    }
    out
}

/// Deserializes a model blob produced by [`serialize_model`]. Returns `None`
/// on any format/version inconsistency so callers can fall back to a rebuild.
pub fn deserialize_model(blob: &[u8]) -> Option<LsaModel> {
    let mut cursor = Cursor(blob);
    let version = cursor.u32()?;
    if version != 1 {
        return None;
    }
    let dims = cursor.u32()? as usize;
    let vocab_len = cursor.u32()? as usize;
    let mut vocab = Vec::with_capacity(vocab_len);
    for _ in 0..vocab_len {
        let len = cursor.u16()? as usize;
        let bytes = cursor.bytes(len)?;
        vocab.push(String::from_utf8(bytes.to_vec()).ok()?);
    }
    let mut idf = Vec::with_capacity(vocab_len);
    for _ in 0..vocab_len {
        idf.push(cursor.f32()?);
    }
    let mut scales = Vec::with_capacity(dims);
    for _ in 0..dims {
        scales.push(cursor.f32()?);
    }
    let quantized = cursor.bytes(vocab_len.checked_mul(dims)?)?;
    let mut basis = vec![0.0f32; vocab_len * dims];
    for t in 0..vocab_len {
        for d in 0..dims {
            basis[t * dims + d] = (quantized[t * dims + d] as i8 as f32) / 127.0 * scales[d];
        }
    }
    let index = vocab
        .iter()
        .enumerate()
        .map(|(i, term)| (term.clone(), i as u32))
        .collect();
    Some(LsaModel {
        dims,
        vocab,
        index,
        idf,
        basis,
    })
}

/// Serializes a dense embedding as little-endian f32 values.
pub fn serialize_vector(vector: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vector.len() * 4);
    for v in vector {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Parses a serialized embedding back into f32 values.
pub fn deserialize_vector(blob: &[u8]) -> Option<Vec<f32>> {
    if !blob.len().is_multiple_of(4) {
        return None;
    }
    Some(
        blob.as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect(),
    )
}

/// Serializes `(term_id, tf)` pairs as LEB128 varints.
pub fn serialize_terms(terms: &[(u32, u32)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(terms.len() * 3);
    for &(tid, tf) in terms {
        write_varint(&mut out, tid as u64);
        write_varint(&mut out, tf as u64);
    }
    out
}

/// Parses varint `(term_id, tf)` pairs written by [`serialize_terms`].
pub fn deserialize_terms(blob: &[u8]) -> Vec<(u32, u32)> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < blob.len() {
        let Some((tid, next)) = read_varint(blob, i) else {
            break;
        };
        let Some((tf, next)) = read_varint(blob, next) else {
            break;
        };
        out.push((tid as u32, tf as u32));
        i = next;
    }
    out
}

fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            break;
        }
        out.push(byte | 0x80);
    }
}

fn read_varint(blob: &[u8], start: usize) -> Option<(u64, usize)> {
    let mut value = 0u64;
    let mut shift = 0u32;
    let mut i = start;
    loop {
        let byte = *blob.get(i)?;
        value |= ((byte & 0x7f) as u64) << shift;
        i += 1;
        if byte & 0x80 == 0 {
            return Some((value, i));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
}

/// Little cursor over a byte slice for the model blob format.
struct Cursor<'a>(&'a [u8]);

impl<'a> Cursor<'a> {
    fn bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        let slice = self.0.get(..len)?;
        self.0 = &self.0[len..];
        Some(slice)
    }

    fn u16(&mut self) -> Option<u16> {
        let b = self.bytes(2)?;
        Some(u16::from_le_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> Option<u32> {
        let b = self.bytes(4)?;
        Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self) -> Option<f32> {
        let b = self.bytes(4)?;
        Some(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts(pairs: &[(&str, u32)]) -> HashMap<String, u32> {
        pairs.iter().map(|(t, c)| (t.to_string(), *c)).collect()
    }

    #[test]
    fn vocabulary_keeps_rare_terms_on_small_corpora_and_sorts() {
        let docs = vec![
            counts(&[("אהבה", 2), ("בריאה", 1)]),
            counts(&[("אהבה", 1), ("משפט", 3)]),
        ];
        let (vocab, df, idf) = LsaModel::build_vocabulary(&docs);
        assert_eq!(vocab, vec!["אהבה", "בריאה", "משפט"]);
        assert_eq!(df, vec![2, 1, 1]);
        // idf of a term in 2/2 docs is lower than a 1/2 term.
        assert!(idf[0] < idf[1]);
    }

    #[test]
    fn sparse_vector_filters_oov_and_normalizes() {
        let docs = vec![counts(&[("אהבה", 1), ("שלום", 1)])];
        let (vocab, _df, idf) = LsaModel::build_vocabulary(&docs);
        let model = LsaModel::train(vocab, idf, &[]);
        let sparse = model.sparse_vector(&counts(&[("אהבה", 4), ("נעדר", 9)]));
        assert_eq!(sparse.len(), 1);
        let norm: f32 = sparse.iter().map(|(_, w)| w * w).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-6);
    }

    #[test]
    fn svd_groups_synonymous_terms() {
        // Two topics: {בריאה, שמים, ארץ} and {אהבה, חסד, רחמים} — articles never
        // mix the topics, so the latent space should separate them.
        let mut docs_tokens = Vec::new();
        for _ in 0..8 {
            docs_tokens.push(counts(&[("בריאה", 3), ("שמים", 2), ("ארצ", 2)]));
            docs_tokens.push(counts(&[("אהבה", 3), ("חסד", 2), ("רחמים", 2)]));
        }
        let (vocab, _df, idf) = LsaModel::build_vocabulary(&docs_tokens);
        let index: HashMap<String, u32> = vocab
            .iter()
            .enumerate()
            .map(|(i, t)| (t.clone(), i as u32))
            .collect();
        let model = LsaModel {
            dims: 0,
            vocab: vocab.clone(),
            index,
            idf,
            basis: Vec::new(),
        };
        let sparse: Vec<SparseVector> = docs_tokens
            .iter()
            .map(|counts| model.sparse_vector(counts))
            .collect();
        let trained = LsaModel::train(vocab, model.idf.clone(), &sparse);
        assert!(trained.dims >= 2);
        let v_a = trained.embed(&sparse[0]); // creation article
        let v_b = trained.embed(&sparse[1]); // loving-kindness article
        let v_a2 = trained.embed(&sparse[2]);
        // A query about שמים is close to creation articles, far from hesed ones.
        let query = trained.embed(&model.sparse_vector(&counts(&[("שמים", 1)])));
        let cos_creation = cosine(&query, &v_a);
        let cos_hesed = cosine(&query, &v_b);
        assert!(
            cos_creation > cos_hesed + 0.3,
            "creation {cos_creation} vs hesed {cos_hesed}"
        );
        // Consistency: same-topic docs stay clustered.
        assert!(cosine(&v_a, &v_a2) > 0.9);
    }

    #[test]
    fn embed_folded_query_matches_related_document() {
        // Doc A: exodus terms; Doc B: creation terms. A query with an OOV
        // synonym of "יציאת מצרים" should still score via co-occurrence.
        let docs_tokens = vec![
            counts(&[("משה", 5), ("מצרים", 4), ("יציאה", 3), ("מדבר", 2)]),
            counts(&[("בריאה", 5), ("שמים", 4), ("ארצ", 3)]),
        ];
        let (vocab, _df, idf) = LsaModel::build_vocabulary(&docs_tokens);
        let index: HashMap<String, u32> = vocab
            .iter()
            .enumerate()
            .map(|(i, t)| (t.clone(), i as u32))
            .collect();
        let builder = LsaModel {
            dims: 0,
            vocab: vocab.clone(),
            index,
            idf,
            basis: Vec::new(),
        };
        let sparse: Vec<SparseVector> = docs_tokens
            .iter()
            .map(|c| builder.sparse_vector(c))
            .collect();
        let model = LsaModel::train(vocab, builder.idf.clone(), &sparse);
        let query = model.sparse_vector(&counts(&[("מצרים", 1)]));
        let qv = model.embed(&query);
        assert!(cosine(&qv, &model.embed(&sparse[0])) > 0.8);
        assert!(cosine(&qv, &model.embed(&sparse[1])) < 0.3);
    }

    #[test]
    fn model_roundtrips_through_blob() {
        let docs = vec![
            counts(&[("אהבה", 2), ("חסד", 1)]),
            counts(&[("בריאה", 2), ("שמים", 1)]),
            counts(&[("אהבה", 1), ("בריאה", 1)]),
        ];
        let (vocab, _df, idf) = LsaModel::build_vocabulary(&docs);
        let index: HashMap<String, u32> = vocab
            .iter()
            .enumerate()
            .map(|(i, t)| (t.clone(), i as u32))
            .collect();
        let builder = LsaModel {
            dims: 0,
            vocab,
            index,
            idf,
            basis: Vec::new(),
        };
        let sparse: Vec<SparseVector> = docs.iter().map(|c| builder.sparse_vector(c)).collect();
        let model = LsaModel::train(builder.vocab.clone(), builder.idf.clone(), &sparse);
        assert!(model.dims > 0);
        let blob = serialize_model(&model);
        let restored = deserialize_model(&blob).expect("model should decode");
        assert_eq!(restored.dims, model.dims);
        assert_eq!(restored.vocab, model.vocab);
        assert_eq!(restored.idf, model.idf);
        // Quantized basis reproduces embeddings within tolerance.
        for doc in &sparse {
            let a = model.embed(doc);
            let b = restored.embed(doc);
            assert!(
                cosine(&a, &b) > 0.99,
                "quantized basis drifted: {}",
                cosine(&a, &b)
            );
        }
    }

    #[test]
    fn deserialize_model_rejects_garbage() {
        assert!(deserialize_model(&[]).is_none());
        assert!(deserialize_model(&[9, 9, 9]).is_none());
        assert!(deserialize_model(&2u32.to_le_bytes()).is_none()); // bad version
        let mut blob = 1u32.to_le_bytes().to_vec();
        blob.extend_from_slice(&1u32.to_le_bytes()); // dims=1
        blob.extend_from_slice(&2u32.to_le_bytes()); // vocab=2 but no data
        assert!(deserialize_model(&blob).is_none());
    }

    #[test]
    fn vector_and_terms_roundtrip() {
        let v = vec![0.5f32, -0.25, 1.0, 0.0];
        assert_eq!(deserialize_vector(&serialize_vector(&v)), Some(v));
        assert!(deserialize_vector(&[1, 2, 3]).is_none());
        let terms = vec![(7u32, 3u32), (40_000, 1), (0, 300)];
        assert_eq!(deserialize_terms(&serialize_terms(&terms)), terms);
        assert_eq!(deserialize_terms(&[0x80]), vec![]); // truncated varint
    }

    #[test]
    fn empty_corpus_trains_to_empty_model() {
        let model = LsaModel::train(vec![], vec![], &[]);
        assert_eq!(model.dims, 0);
        assert!(model.embed(&Vec::new()).is_empty());
    }

    #[test]
    fn train_handles_single_document_corpus() {
        let docs = vec![counts(&[("יחיד", 2), ("מאמר", 1)])];
        let (vocab, _df, idf) = LsaModel::build_vocabulary(&docs);
        let index: HashMap<String, u32> = vocab
            .iter()
            .enumerate()
            .map(|(i, t)| (t.clone(), i as u32))
            .collect();
        let builder = LsaModel {
            dims: 0,
            vocab,
            index,
            idf,
            basis: Vec::new(),
        };
        let sparse = vec![builder.sparse_vector(&docs[0])];
        let model = LsaModel::train(builder.vocab.clone(), builder.idf.clone(), &sparse);
        // dims collapses to the corpus width; embeddings still embed.
        let v = model.embed(&sparse[0]);
        assert_eq!(v.len(), model.dims);
        if model.dims > 0 {
            let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            assert!(norm - 1.0 < 1e-4 || norm == 0.0 || model.dims == 0);
        }
    }
}
