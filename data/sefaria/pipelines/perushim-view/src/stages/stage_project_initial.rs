//! Initial project stage: Extract authors, Hebrew title, filtered versions, and schema.
//!
//! This stage performs the first projection, transforming raw Sefaria index + text data into:
//! - `alt_structs`: Alternative structure information
//! - `authors`: Resolved Hebrew author names from the person collection, with fallbacks
//! - `compDate`, `pubDate`: Composition and publication dates
//! - `schema`: Structure metadata (depth, addressTypes, sectionNames, nodes)
//! - `title`: Primary Hebrew title from schema.titles
//! - `versions`: Filtered to Hebrew-only, excluding problematic version titles/sources
//!
//! Due to the complexity of this stage (deeply nested MongoDB expressions),
//! the inner content is defined as JSON and parsed at runtime.

use bson::{Document, doc};

/// JSON representation of the project stage inner content.
/// This is parsed at runtime to avoid doc! macro recursion issues.
const PROJECT_INITIAL_INNER_JSON: &str = include_str!("project_initial_inner.json");

/// Returns the `$project` stage document.
pub fn build() -> Document {
    let inner: Document = serde_json::from_str(PROJECT_INITIAL_INNER_JSON)
        .expect("Failed to parse project_initial_inner.json - this is a bug in the stage definition");

    doc! {
        "$project": inner
    }
}
