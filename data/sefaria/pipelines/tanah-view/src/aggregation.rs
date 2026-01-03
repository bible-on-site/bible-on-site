//! MongoDB aggregation pipeline for extracting Tanah view data from Sefaria dump.
//!
//! This module combines all pipeline stages and generates/loads external data at runtime.
//!
//! # Data Files
//!
//! - **Perek headers**: `data/annotations/perakim-headers.yml`
//! - **Cycle dates & star rise**: Generated at runtime from Hebrew calendar calculations

use anyhow::Result;
use bson::Document;
use std::path::Path;

use crate::data::{cycle_dates, headers};
use crate::stages::{
    stage_cleanup, stage_group, stage_lookup, stage_match, stage_offsets, stage_perek_dates,
    stage_project, stage_sort, stage_window,
};

/// Returns the MongoDB aggregation pipeline for extracting Tanah view data.
///
/// # Arguments
/// * `data_root` - Path to the `data/` directory containing headers
///
/// # Pipeline Stages
/// 1. **Match**: Filter for "Tanach with Ta'amei Hamikra" version
/// 2. **Lookup**: Join with index collection for metadata
/// 3. **Project**: Transform to Sefer/Perek/Pasuk/Segment structure
/// 4. **Window**: Calculate cumulative perek count
/// 5. **Perek Dates**: Add perekId, header, cycle dates, and star rise times
/// 6. **Group**: Merge split sefarim (שמואל, מלכים, etc.)
/// 7. **Sort**: Order by canonical order
/// 8. **Offsets**: Compute ktiv/qri offset properties
/// 9. **Cleanup**: Remove internal fields
pub fn build_pipeline(data_root: &Path) -> Result<Vec<Document>> {
    // Load headers from file
    let perek_headers = headers::load(data_root)?;

    // Generate cycle dates and star rise times
    let cycle_data = cycle_dates::generate();

    // Convert to BSON
    let headers_bson = headers::to_bson_array(&perek_headers);
    let dates_bson = cycle_dates::dates_to_bson(&cycle_data.dates);
    let star_rise_bson = cycle_dates::star_rise_to_bson(&cycle_data.star_rise);

    // Build pipeline from modular stages
    let pipeline = vec![
        stage_match::build(),
        stage_lookup::build(),
        stage_project::build(),
        stage_window::build(),
        stage_perek_dates::build(headers_bson, dates_bson, star_rise_bson),
        stage_group::build(),
        stage_sort::build(),
        stage_offsets::build(),
        stage_cleanup::build(),
    ];

    Ok(pipeline)
}
