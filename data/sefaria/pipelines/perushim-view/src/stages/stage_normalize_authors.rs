//! AddFields stage: Normalize author names for person collection lookup.
//!
//! The `index` collection stores author identifiers as hyphenated strings
//! (e.g., "isaac-abarbanel", "יצחק-קארו"). This stage normalizes them to
//! lowercase Latin keys that match the `person` collection's `key` field format.
//!
//! Many index author keys include a first name or suffix that doesn't appear in
//! the person key (e.g., "isaac-abarbanel" vs person key "Abarbanel"), so we
//! maintain explicit mappings for those cases.

use bson::{Document, doc};

/// Returns the `$addFields` stage document.
///
/// Transforms the `authors` array:
/// - Explicit mappings for keys whose default normalization doesn't match the person key
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
                                    "branches": author_mapping_branches(),
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

/// Explicit index-author-key → person-key mappings for cases where the default
/// hyphen→space+lowercase normalization doesn't match the person collection key.
fn author_mapping_branches() -> Vec<Document> {
    [
        // Hebrew key that doesn't normalize to Latin via default path
        ("יצחק-קארו", "yitzchak karo"),
        // Index uses full name but person key is the short/common name
        ("isaac-abarbanel", "abarbanel"),
        ("ovadiah-seforno", "sforno"),
        ("moses-alshikh", "alshikh"),
        ("menachem-meiri", "hameiri"),
        // Index key has different structure than person key
        ("moses-isserles-(rema)", "moses isserles"),
        ("moses-kimchi", "joseph kimchi"),
        // Index key has trailing digit (Sefaria data quirk)
        ("chizkuni1", "chizkuni"),
    ]
    .into_iter()
    .map(|(from, to)| {
        doc! {
            "case": { "$eq": ["$$author", from] },
            "then": to
        }
    })
    .collect()
}
