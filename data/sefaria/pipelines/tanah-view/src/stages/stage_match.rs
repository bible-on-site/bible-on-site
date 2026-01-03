//! Match stage: Filter for Tanach with Ta'amei Hamikra version.

use bson::{doc, Document};

/// Returns the `$match` stage document.
pub fn build() -> Document {
    doc! {
        "$match": doc! {
            "versionTitle": "Tanach with Ta'amei Hamikra"
        }
    }
}
