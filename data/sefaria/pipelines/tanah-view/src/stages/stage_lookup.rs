//! Lookup stage: Join with index collection for metadata.

use bson::{Document, doc};

/// Returns the `$lookup` stage document.
pub fn build() -> Document {
    doc! {
        "$lookup": doc! {
            "from": "index",
            "localField": "title",
            "foreignField": "title",
            "as": "metadata"
        }
    }
}
