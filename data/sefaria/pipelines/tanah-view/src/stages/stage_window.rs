//! Window stage: Calculate running total for perek numbering.

use bson::{doc, Bson, Document};

/// Returns the `$setWindowFields` stage document.
///
/// Calculates the cumulative perek count (`perekTo`) across all sefarim,
/// used for assigning unique perek IDs (1-929).
pub fn build() -> Document {
    doc! {
        "$setWindowFields": doc! {
            "partitionBy": Bson::Null,
            "sortBy": doc! {
                "order": 1
            },
            "output": doc! {
                "perekTo": doc! {
                    "$sum": doc! {
                        "$size": "$perakim"
                    },
                    "window": doc! {
                        "documents": [
                            "unbounded",
                            "current"
                        ]
                    }
                }
            }
        }
    }
}
