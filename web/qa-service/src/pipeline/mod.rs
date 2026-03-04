//! Pipeline: Ingest → Retrieve → Reason → Validate → Surface.
//! Week 2: MiniLM embeddings for Retrieve, XLM-RoBERTa extractive QA for Reason.

pub mod ingest;
pub mod reason;
pub mod retrieve;
pub mod surface;
pub mod validate;
