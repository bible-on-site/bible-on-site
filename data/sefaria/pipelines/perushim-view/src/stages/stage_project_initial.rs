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
    let inner: Document = serde_json::from_str(PROJECT_INITIAL_INNER_JSON).expect(
        "Failed to parse project_initial_inner.json - this is a bug in the stage definition",
    );

    doc! {
        "$project": inner
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema_projection() -> Document {
        build()
            .get_document("$project")
            .unwrap()
            .get_document("schema")
            .unwrap()
            .clone()
    }

    #[test]
    fn keeps_child_nodes_of_book_level_schema_nodes() {
        // Abarbanel on Torah nests its depth-3 content under a child node of each
        // book node; dropping `nodes.nodes` here silently loses the whole Torah.
        let schema = schema_projection();
        let child = schema
            .get_document("nodes")
            .unwrap()
            .get_document("nodes")
            .expect("nested node projection");

        for key in ["key", "depth", "default"] {
            assert!(child.contains_key(key), "nested node must project {key}");
        }
    }

    #[test]
    fn keeps_book_level_node_identity_and_depth() {
        let nodes = schema_projection().get_document("nodes").unwrap().clone();
        for key in ["key", "depth"] {
            assert!(nodes.contains_key(key), "book node must project {key}");
        }
    }
}
