//! AddFields stage: Normalize author names for person collection lookup.
//!
//! The `index` collection stores author identifiers as hyphenated Hebrew strings
//! (e.g., "יצחק-קארו"). This stage normalizes them to lowercase Latin keys
//! that match the `person` collection's `key` field format.

use bson::{Document, doc};

/// Returns the `$addFields` stage document.
///
/// Transforms the `authors` array:
/// - Special case: "יצחק-קארו" → "yitzchak karo"
/// - Default: replaces hyphens with spaces and lowercases
/// - If `authors` is not an array, sets it to an empty array
pub fn build() -> Document {
    doc! {
        "$addFields": {
            "authors": {
                "$cond": {
                    "if": {
                        "$eq": [{ "$type": "$authors" }, "array"]
                    },
                    "then": {
                        "$map": {
                            "input": "$authors",
                            "as": "author",
                            "in": {
                                "$switch": {
                                    "branches": [
                                        {
                                            "case": { "$eq": ["$$author", "יצחק-קארו"] },
                                            "then": "yitzchak karo"
                                        }
                                    ],
                                    "default": {
                                        "$toLower": {
                                            "$replaceAll": {
                                                "input": "$$author",
                                                "find": "-",
                                                "replacement": " "
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "else": []
                }
            }
        }
    }
}
