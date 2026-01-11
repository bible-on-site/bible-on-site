//! Sort stage: Order sefarim by their canonical order.

use bson::{Document, doc};

/// Returns the `$sort` stage document.
pub fn build() -> Document {
    doc! {
        "$sort": doc! {
            "order": 1
        }
    }
}
