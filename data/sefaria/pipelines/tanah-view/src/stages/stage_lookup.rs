//! Lookup stage: Join with index collection for metadata.

use bson::{doc, Document};

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
