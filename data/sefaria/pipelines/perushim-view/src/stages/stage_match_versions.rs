//! Match stage: Filter out documents with no Hebrew versions.
//!
//! After the initial projection filters versions to Hebrew-only and excludes
//! problematic version titles/sources, some documents may end up with zero
//! versions. This stage removes those empty results.

use bson::{Document, doc};

/// Returns the `$match` stage document.
///
/// Filters for documents where `versions_count > 0`.
pub fn build() -> Document {
    doc! {
        "$match": {
            "$or": [
                { "versions_count": { "$gt": 0 } },
                // A missing mapped edition must fail extraction, not silently
                // remove Tanchuma from the generated catalog again.
                { "enTitle": "Midrash Tanchuma" }
            ]
        }
    }
}
