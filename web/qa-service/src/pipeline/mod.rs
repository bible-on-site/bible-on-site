//! Pipeline: Ingest → Retrieve → Surface.
//! Phase 0: Malbim + Or HaChaim perushim + articles from MySQL, in-memory chunks, keyword RAG.

pub mod ingest;
pub mod retrieve;
pub mod surface;
