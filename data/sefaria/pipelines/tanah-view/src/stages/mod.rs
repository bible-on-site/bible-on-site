//! Aggregation pipeline stages.
//!
//! Each stage is defined in its own module for maintainability.

pub mod stage_cleanup;
pub mod stage_group;
pub mod stage_lookup;
pub mod stage_match;
pub mod stage_offsets;
pub mod stage_perek_dates;
pub mod stage_project;
pub mod stage_sort;
pub mod stage_window;
