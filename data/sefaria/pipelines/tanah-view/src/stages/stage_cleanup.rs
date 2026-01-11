//! Cleanup stage: Remove internal fields and handle nulls.

use bson::{Bson, Document, doc};

/// Returns the final `$set` stage document for cleanup.
///
/// This stage:
/// - Removes the internal `order` field
/// - Removes `tanachUsName` if null
/// - Removes `additionals` if empty array
/// - Removes `perakim` if null
pub fn build() -> Document {
    doc! {
        "$set": doc! {
            "order": "$$REMOVE",
            "tanachUsName": doc! {
                "$cond": doc! {
                    "if": doc! {
                        "$eq": [
                            "$tanachUsName",
                            Bson::Null
                        ]
                    },
                    "then": "$$REMOVE",
                    "else": "$tanachUsName"
                }
            },
            "additionals": doc! {
                "$cond": doc! {
                    "if": doc! {
                        "$eq": [
                            "$additionals",
                            []
                        ]
                    },
                    "then": "$$REMOVE",
                    "else": "$additionals"
                }
            },
            "perakim": doc! {
                "$cond": doc! {
                    "if": doc! {
                        "$eq": [
                            "$perakim",
                            Bson::Null
                        ]
                    },
                    "then": "$$REMOVE",
                    "else": "$perakim"
                }
            }
        }
    }
}
