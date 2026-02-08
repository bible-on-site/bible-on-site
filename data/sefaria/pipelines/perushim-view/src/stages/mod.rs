//! Aggregation pipeline stages for the perushim-view pipeline.
//!
//! Each stage is defined in its own module for maintainability.
//! Complex projection stages use JSON files for their inner content
//! to avoid doc! macro recursion issues.

pub mod stage_lookup_person;
pub mod stage_lookup_texts;
pub mod stage_match_index;
pub mod stage_match_versions;
pub mod stage_normalize_authors;
pub mod stage_project_final;
pub mod stage_project_initial;
pub mod stage_project_name;
pub mod stage_sort;
