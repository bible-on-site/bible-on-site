//! Lookup stage: Join with the `person` collection to resolve author details.
//!
//! This stage looks up the `person` collection using the normalized author keys
//! from the previous stage, matching on `toLower(person.key)` against the
//! normalized authors array.

use bson::{Document, doc};

/// Returns the `$lookup` stage document with a pipeline sub-query.
///
/// The lookup matches person documents where `toLower(key)` is in
/// the normalized `authors` array, replacing the normalized keys
/// with full person documents.
pub fn build() -> Document {
    doc! {
        "$lookup": {
            "from": "person",
            "let": {
                "authors": "$authors"
            },
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$in": [
                                { "$toLower": "$key" },
                                "$$authors"
                            ]
                        }
                    }
                }
            ],
            "as": "authors"
        }
    }
}
