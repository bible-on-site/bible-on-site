//! Sentence embedder: intfloat/multilingual-e5-small exported to ONNX.
//!
//! E5 models require input prefixes: "query: " for queries and
//! "passage: " for corpus passages. Embeddings are mean-pooled over
//! `last_hidden_state` and L2-normalized, so cosine similarity equals
//! the dot product.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use ndarray::{Array1, Array2};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

const EMBED_DIM: usize = 384;
const MAX_TOKENS: usize = 512;
const CACHE_MAGIC: u32 = 0x5141_454D; // "QAEM"
const CACHE_VERSION: u32 = 1;

/// Wraps the ONNX session + tokenizer. `Session::run` needs `&mut self`, so the
/// session lives behind a mutex — the lock is only held for one inference call.
pub struct Embedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    cache_path: PathBuf,
}

impl Embedder {
    /// Load `model.onnx` + `tokenizer.json` from `dir` (`models/embedder/`).
    /// The passage-embedding cache lives next to it at
    /// `models/embeddings_cache.bin`.
    pub fn load(dir: &Path) -> Result<Self> {
        let session = Session::builder()?
            .commit_from_file(dir.join("model.onnx"))
            .with_context(|| format!("loading ONNX embedder from {}", dir.display()))?;
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| anyhow::anyhow!("loading tokenizer from {}: {e}", dir.display()))?;
        let cache_path = dir.parent().unwrap_or(dir).join("embeddings_cache.bin");
        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
            cache_path,
        })
    }

    /// Embed a single query string (E5 "query: " prefix applied here).
    pub fn embed_query(&self, text: &str) -> Result<Array1<f32>> {
        let batch = self.embed_batch(&[format!("query: {text}")])?;
        Ok(batch.row(0).to_owned())
    }

    /// Embed corpus passages in batches (E5 "passage: " prefix applied here),
    /// reading/writing a flat binary cache at `models/embeddings_cache.bin`.
    /// The cache is reused only when its row count matches `texts.len()`.
    pub fn embed_passages_cached(&self, texts: &[&str], batch_size: usize) -> Result<Array2<f32>> {
        if let Some(cached) = self.read_cache(texts.len())? {
            return Ok(cached);
        }

        let mut all = Array2::<f32>::zeros((texts.len(), EMBED_DIM));
        for (offset, batch) in texts.chunks(batch_size.max(1)).enumerate() {
            let prefixed: Vec<String> = batch.iter().map(|t| format!("passage: {t}")).collect();
            let embedded = self.embed_batch(&prefixed)?;
            let start = offset * batch_size.max(1);
            all.slice_mut(ndarray::s![start..start + embedded.nrows(), ..])
                .assign(&embedded);
        }
        self.write_cache(&all)?;
        Ok(all)
    }

    /// Run the model on pre-prefixed texts and mean-pool + L2-normalize each row.
    fn embed_batch(&self, texts: &[String]) -> Result<Array2<f32>> {
        let mut encodings = Vec::with_capacity(texts.len());
        for text in texts {
            encodings.push(
                self.tokenizer
                    .encode(text.as_str(), true)
                    .map_err(|e| anyhow::anyhow!("tokenizing passage: {e}"))?,
            );
        }

        let batch = encodings.len();
        let seq_len = encodings
            .iter()
            .map(|e| e.get_ids().len())
            .max()
            .unwrap_or(0)
            .clamp(1, MAX_TOKENS);

        let mut input_ids = Array2::<i64>::zeros((batch, seq_len));
        let mut attention = Array2::<i64>::zeros((batch, seq_len));
        for (row, encoding) in encodings.iter().enumerate() {
            let len = encoding.get_ids().len().min(seq_len);
            input_ids
                .slice_mut(ndarray::s![row, ..len])
                .assign(&ndarray::Array1::from_iter(
                    encoding.get_ids()[..len].iter().map(|&id| id as i64),
                ));
            attention
                .slice_mut(ndarray::s![row, ..len])
                .assign(&ndarray::Array1::from_iter(
                    encoding.get_attention_mask()[..len]
                        .iter()
                        .map(|&m| m as i64),
                ));
        }

        let mut session = self.session.lock().expect("embedder session poisoned");
        let outputs = session.run(ort::inputs![
            "input_ids" => Tensor::from_array(input_ids)?,
            "attention_mask" => Tensor::from_array(attention.clone())?,
        ])?;

        // optimum exports a single `last_hidden_state` output [B, S, EMBED_DIM].
        let (shape, hidden) = outputs[0].try_extract_tensor::<f32>()?;
        anyhow::ensure!(
            shape.len() == 3 && shape[2] as usize == EMBED_DIM,
            "unexpected embedder output shape {shape:?}"
        );
        let hidden = hidden.to_vec();
        drop(outputs);
        drop(session);

        let mut out = Array2::<f32>::zeros((batch, EMBED_DIM));
        for row in 0..batch {
            let mut sum = vec![0f32; EMBED_DIM];
            let mut weight = 0f32;
            for col in 0..seq_len {
                let mask = attention[[row, col]] as f32;
                if mask == 0.0 {
                    continue;
                }
                weight += mask;
                let base = (row * seq_len + col) * EMBED_DIM;
                for (d, s) in sum.iter_mut().enumerate() {
                    *s += hidden[base + d] * mask;
                }
            }
            let inv = if weight > 0.0 { 1.0 / weight } else { 0.0 };
            let mut norm_sq = 0f32;
            for (d, s) in sum.iter().enumerate() {
                let v = s * inv;
                out[[row, d]] = v;
                norm_sq += v * v;
            }
            let norm = norm_sq.sqrt();
            if norm > 0.0 {
                for d in 0..EMBED_DIM {
                    out[[row, d]] /= norm;
                }
            }
        }
        Ok(out)
    }

    fn read_cache(&self, rows: usize) -> Result<Option<Array2<f32>>> {
        let Ok(file) = File::open(&self.cache_path) else {
            return Ok(None);
        };
        let mut reader = BufReader::new(file);
        let mut header = [0u8; 20];
        if reader.read_exact(&mut header).is_err() {
            return Ok(None);
        }
        let magic = u32::from_le_bytes(header[0..4].try_into().unwrap());
        let version = u32::from_le_bytes(header[4..8].try_into().unwrap());
        let cached_rows = u64::from_le_bytes(header[8..16].try_into().unwrap()) as usize;
        let cols = u32::from_le_bytes(header[16..20].try_into().unwrap()) as usize;
        if magic != CACHE_MAGIC
            || version != CACHE_VERSION
            || cached_rows != rows
            || cols != EMBED_DIM
        {
            return Ok(None);
        }
        let mut data = Vec::with_capacity(rows * EMBED_DIM);
        let mut buf = [0u8; 4096];
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            for chunk in buf[..n].as_chunks::<4>().0 {
                data.push(f32::from_le_bytes(*chunk));
            }
        }
        if data.len() != rows * EMBED_DIM {
            return Ok(None);
        }
        Ok(Some(
            Array2::from_shape_vec((rows, EMBED_DIM), data).expect("shape verified above"),
        ))
    }

    fn write_cache(&self, embeddings: &Array2<f32>) -> Result<()> {
        let file = File::create(&self.cache_path).with_context(|| {
            format!("creating embedding cache at {}", self.cache_path.display())
        })?;
        let mut writer = BufWriter::new(file);
        writer.write_all(&CACHE_MAGIC.to_le_bytes())?;
        writer.write_all(&CACHE_VERSION.to_le_bytes())?;
        writer.write_all(&(embeddings.nrows() as u64).to_le_bytes())?;
        writer.write_all(&(EMBED_DIM as u32).to_le_bytes())?;
        for row in embeddings.rows() {
            for v in row.iter() {
                writer.write_all(&v.to_le_bytes())?;
            }
        }
        writer.flush()?;
        // Remove any half-written stale tail by truncating to current size.
        fs::metadata(&self.cache_path)?;
        Ok(())
    }
}
