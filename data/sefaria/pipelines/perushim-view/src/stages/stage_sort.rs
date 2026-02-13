//! Sort stage: Order perushim by name and sefer number.

use bson::{Document, doc};

/// Returns the `$sort` stage document.
///
/// Sorts by:
/// 1. `name` (ascending) — groups all perushim of the same commentator together
/// 2. `sefer` (ascending) — orders by canonical Tanakh book order within each commentator
pub fn build() -> Document {
    doc! {
        "$sort": {
            "name": 1,
            "sefer": 1
        }
    }
}
