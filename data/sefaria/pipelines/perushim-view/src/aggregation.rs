//! MongoDB aggregation pipeline for extracting perushim (commentaries) data from Sefaria dump.
//!
//! This module combines all pipeline stages to build the full aggregation pipeline
//! that runs against the `index` collection.
//!
//! # Pipeline Overview
//!
//! 1. **Match Index**: Filter for Tanakh commentaries, excluding base texts and problematic titles
//! 2. **Lookup Texts**: Join with `texts` collection for version data
//! 3. **Normalize Authors**: Transform author identifiers for person collection lookup
//! 4. **Lookup Person**: Resolve author details from the `person` collection
//! 5. **Project Initial**: Extract Hebrew title, authors, filtered versions, schema
//! 6. **Project Name**: Parse perush name and sefer name from Hebrew title
//! 7. **Match Versions**: Filter out entries with no Hebrew versions
//! 8. **Project Final**: Map sefer names to canonical numbers, finalize fields
//! 9. **Sort**: Order by commentator name and sefer number

use bson::Document;

use crate::stages::{
    stage_lookup_person, stage_lookup_texts, stage_match_index, stage_match_versions,
    stage_normalize_authors, stage_project_final, stage_project_initial, stage_project_name,
    stage_sort,
};

/// Returns the MongoDB aggregation pipeline for extracting perushim data.
///
/// This pipeline runs against the `index` collection and joins with `texts` and `person`.
pub fn build_pipeline() -> Vec<Document> {
    vec![
        stage_match_index::build(),
        stage_lookup_texts::build(),
        stage_normalize_authors::build(),
        stage_lookup_person::build(),
        stage_project_initial::build(),
        stage_project_name::build(),
        stage_match_versions::build(),
        stage_project_final::build(),
        stage_sort::build(),
    ]
}
