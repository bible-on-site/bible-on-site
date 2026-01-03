//! Project stage: Transform raw Sefaria data into Tanah view structure.
//!
//! This stage projects the document structure with:
//! - `order`: Canonical order number
//! - `letter`: Split letter for additionals (א, ב, ע, נ)
//! - `name`: Hebrew name
//! - `tanachUsName`: English name
//! - `helek`: Section (תורה, נביאים, כתובים)
//! - `pesukimCount`: Total pesukim count
//! - `perakim`: Array of perakim with pesukim and segments
//!
//! Due to the complexity of this stage (deeply nested MongoDB expressions),
//! the inner content is defined as JSON and parsed at runtime.

use bson::{doc, Document};

/// JSON representation of the project stage inner content.
/// This is parsed at runtime to avoid doc! macro recursion issues.
const PROJECT_INNER_JSON: &str = include_str!("project_inner.json");

/// Returns the `$project` stage document.
pub fn build() -> Document {
    // Parse the inner JSON to a Document
    let inner: Document = serde_json::from_str(PROJECT_INNER_JSON)
        .expect("Failed to parse project_inner.json - this is a bug in the stage definition");

    doc! {
        "$project": inner
    }
}
