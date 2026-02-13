//! Name extraction project stage: Parse perush name and sefer name from Hebrew title.
//!
//! This stage extracts:
//! - `name`: The perush/commentary name (e.g., "רש\"י" from "רש\"י על בראשית")
//! - `seferHebName`: The sefer name (e.g., "בראשית" from "רש\"י על בראשית")
//! - `authors`: With overrides for specific titles (e.g., Onkelos, Bartenura)
//! - `versions_count`: Count of available versions (used for filtering in next stage)
//!
//! The extraction logic handles several patterns:
//! - "X על Y" — split on " על " to get name and sefer
//! - "תרגום ירושלמי X" — special case for Targum Yerushalmi
//! - "תרגום X" — special case for other Targumim
//! - Direct name mappings for titles that don't follow standard patterns
//!   (e.g., רלב"ג, הטור הארוך, תורת משה - אלשיך)
//!
//! Due to the complexity of this stage (deeply nested MongoDB expressions),
//! the inner content is defined as JSON and parsed at runtime.

use bson::{Document, doc};

/// JSON representation of the project stage inner content.
const PROJECT_NAME_INNER_JSON: &str = include_str!("project_name_inner.json");

/// Returns the `$project` stage document.
pub fn build() -> Document {
    let inner: Document = serde_json::from_str(PROJECT_NAME_INNER_JSON)
        .expect("Failed to parse project_name_inner.json - this is a bug in the stage definition");

    doc! {
        "$project": inner
    }
}
