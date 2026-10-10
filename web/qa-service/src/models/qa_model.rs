//! Extractive QA: deepset/xlm-roberta-base-squad2 exported to ONNX.
//!
//! The model consumes a (question, context) pair and emits per-token
//! `start_logits`/`end_logits`. We take the argmax span whose tokens all
//! belong to the context sequence and return its text + a confidence
//! derived from the softmax probabilities of both ends.

use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

const MAX_TOKENS: usize = 384;
const MAX_ANSWER_TOKENS: usize = 64;

/// A span extracted from a context chunk.
#[derive(Debug, Clone)]
pub struct QaSpan {
    /// The extracted answer text (verbatim from the context).
    pub text: String,
    /// Product of the softmax probabilities of the chosen start/end tokens.
    pub confidence: f64,
}

pub struct QaModel {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
}

impl QaModel {
    /// Load `model.onnx` + `tokenizer.json` from `dir` (`models/qa/`).
    pub fn load(dir: &Path) -> Result<Self> {
        let session = Session::builder()?
            .commit_from_file(dir.join("model.onnx"))
            .with_context(|| format!("loading ONNX QA model from {}", dir.display()))?;
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| anyhow::anyhow!("loading tokenizer from {}: {e}", dir.display()))?;
        Ok(Self {
            session: Mutex::new(session),
            tokenizer,
        })
    }

    /// Extract the best answer span for `question` from `context`, or `None`
    /// when no plausible span exists. Very long contexts are truncated to the
    /// model window rather than strided — retrieval chunks are already small.
    pub fn extract(&self, question: &str, context: &str) -> Result<Option<QaSpan>> {
        let encoding = self
            .tokenizer
            .encode((question, context), true)
            .map_err(|e| anyhow::anyhow!("tokenizing QA pair: {e}"))?;

        let len = encoding.get_ids().len().min(MAX_TOKENS);
        if len == 0 {
            return Ok(None);
        }

        let input_ids: Vec<i64> = encoding.get_ids()[..len]
            .iter()
            .map(|&id| id as i64)
            .collect();
        let attention: Vec<i64> = encoding.get_attention_mask()[..len]
            .iter()
            .map(|&m| m as i64)
            .collect();
        // tokenizers pads get_offsets() with the raw offsets within each
        // segment; sequence ids tell us which tokens belong to the context.
        let offsets = encoding.get_offsets()[..len].to_vec();
        let sequence_ids = encoding.get_sequence_ids()[..len].to_vec();

        let ids_arr = ndarray::Array2::from_shape_vec((1, len), input_ids)?;
        let mask_arr = ndarray::Array2::from_shape_vec((1, len), attention)?;

        let mut session = self.session.lock().expect("qa session poisoned");
        let outputs = session.run(ort::inputs![
            "input_ids" => Tensor::from_array(ids_arr)?,
            "attention_mask" => Tensor::from_array(mask_arr)?,
        ])?;

        let (_, start_logits) = outputs["start_logits"].try_extract_tensor::<f32>()?;
        let (_, end_logits) = outputs["end_logits"].try_extract_tensor::<f32>()?;
        let start_logits = start_logits.to_vec();
        let end_logits = end_logits.to_vec();
        drop(outputs);
        drop(session);

        let n = start_logits.len().min(end_logits.len()).min(len);
        // Mask non-context tokens (question + specials) so the span always
        // lands inside the passage. Context sequence id is 1 for pair inputs.
        let in_context = |i: usize| sequence_ids.get(i).copied().flatten() == Some(1);

        let mut best: Option<(usize, usize, f64)> = None;
        for (s, &s_logit) in start_logits.iter().enumerate().take(n) {
            if !in_context(s) {
                continue;
            }
            for (e_off, &e_logit) in end_logits[s..n].iter().enumerate().take(MAX_ANSWER_TOKENS) {
                let e = s + e_off;
                if !in_context(e) {
                    break;
                }
                let score = s_logit as f64 + e_logit as f64;
                if best.is_none_or(|(_, _, b)| score > b) {
                    best = Some((s, e, score));
                }
            }
        }
        let Some((start, end, _)) = best else {
            return Ok(None);
        };

        let (char_start, char_end) = (offsets[start].0, offsets[end].1);
        if char_end <= char_start || char_end > context.len() {
            return Ok(None);
        }
        let text = context[char_start..char_end].trim().to_string();
        if text.is_empty() {
            return Ok(None);
        }

        let confidence =
            softmax(&start_logits[..n])[start] as f64 * softmax(&end_logits[..n])[end] as f64;
        Ok(Some(QaSpan { text, confidence }))
    }
}

fn softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut exps: Vec<f32> = logits.iter().map(|l| (l - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    if sum > 0.0 {
        for v in exps.iter_mut() {
            *v /= sum;
        }
    }
    exps
}
