//! Lookup stage: Join with the `texts` collection to get version data.
//!
//! Uses a correlated pipeline subquery to pre-filter within MongoDB:
//! - Only Hebrew versions (language: "he")
//! - Exclude problematic versionTitle/versionSource entries
//! - Limit to 1 version per index entry (first matching Hebrew version)
//! - Only project the `chapter` field (actual text content)
//!
//! This avoids the 16MB BSON document size limit that occurs when naively
//! joining large commentaries (e.g., Rashi on Torah has 21MB+ of text data).

use bson::{Document, doc};

/// JSON representation of the lookup sub-pipeline stages.
const LOOKUP_TEXTS_PIPELINE_JSON: &str = include_str!("lookup_texts_pipeline.json");

/// Returns the `$lookup` stage document with correlated pipeline subquery.
pub fn build() -> Document {
    let pipeline: Vec<Document> = serde_json::from_str(LOOKUP_TEXTS_PIPELINE_JSON)
        .expect("Failed to parse lookup_texts_pipeline.json - this is a bug in the stage definition");

    doc! {
        "$lookup": {
            "from": "texts",
            "let": { "idx_title": "$title" },
            "pipeline": pipeline,
            "as": "versions"
        }
    }
}
