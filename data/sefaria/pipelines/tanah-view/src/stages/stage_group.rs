//! Group stage: Merge split sefarim (שמואל, מלכים, דברי הימים, עזרא/נחמיה).
//!
//! This stage groups sefarim that are traditionally considered single books
//! but are split in the source data (e.g., שמואל א + שמואל ב → שמואל).

use bson::{Document, doc};

/// Returns the `$group` stage document.
///
/// Groups split sefarim:
/// - שמואל א + שמואל ב → שמואל
/// - מלכים א + מלכים ב → מלכים
/// - דברי הימים א + דברי הימים ב → דברי הימים
/// - עזרא + נחמיה → עזרא
///
/// The splits are stored in the `additionals` array, while regular sefarim
/// keep their content in `perakim`.
pub fn build() -> Document {
    doc! {
        "$group": doc! {
            "_id": doc! {
                "$switch": doc! {
                    "branches": [
                        doc! {
                            "case": doc! {
                                "$in": [
                                    "$name",
                                    [
                                        "שמואל א",
                                        "שמואל ב"
                                    ]
                                ]
                            },
                            "then": "שמואל"
                        },
                        doc! {
                            "case": doc! {
                                "$in": [
                                    "$name",
                                    [
                                        "מלכים א",
                                        "מלכים ב"
                                    ]
                                ]
                            },
                            "then": "מלכים"
                        },
                        doc! {
                            "case": doc! {
                                "$in": [
                                    "$name",
                                    [
                                        "דברי הימים א",
                                        "דברי הימים ב"
                                    ]
                                ]
                            },
                            "then": "דברי הימים"
                        },
                        doc! {
                            "case": doc! {
                                "$in": [
                                    "$name",
                                    [
                                        "עזרא",
                                        "נחמיה"
                                    ]
                                ]
                            },
                            "then": "עזרא"
                        }
                    ],
                    "default": "$name"
                }
            },
            "name": doc! {
                "$first": doc! {
                    "$switch": doc! {
                        "branches": [
                            doc! {
                                "case": doc! {
                                    "$in": [
                                        "$name",
                                        [
                                            "שמואל א",
                                            "שמואל ב"
                                        ]
                                    ]
                                },
                                "then": "שמואל"
                            },
                            doc! {
                                "case": doc! {
                                    "$in": [
                                        "$name",
                                        [
                                            "מלכים א",
                                            "מלכים ב"
                                        ]
                                    ]
                                },
                                "then": "מלכים"
                            },
                            doc! {
                                "case": doc! {
                                    "$in": [
                                        "$name",
                                        [
                                            "דברי הימים א",
                                            "דברי הימים ב"
                                        ]
                                    ]
                                },
                                "then": "דברי הימים"
                            },
                            doc! {
                                "case": doc! {
                                    "$in": [
                                        "$name",
                                        [
                                            "עזרא",
                                            "נחמיה"
                                        ]
                                    ]
                                },
                                "then": "עזרא"
                            }
                        ],
                        "default": "$name"
                    }
                }
            },
            "order": doc! {
                "$first": "$order"
            },
            "tanachUsName": doc! {
                "$first": doc! {
                    "$cond": doc! {
                        "if": doc! {
                            "$in": [
                                "$name",
                                [
                                    "שמואל א",
                                    "שמואל ב",
                                    "מלכים א",
                                    "מלכים ב",
                                    "דברי הימים א",
                                    "דברי הימים ב",
                                    "עזרא",
                                    "נחמיה"
                                ]
                            ]
                        },
                        "then": "$$REMOVE",
                        "else": "$tanachUsName"
                    }
                }
            },
            "helek": doc! {
                "$first": "$helek"
            },
            "pesukimCount": doc! {
                "$sum": "$pesukimCount"
            },
            "perekFrom": doc! {
                "$first": "$perekFrom"
            },
            "perekTo": doc! {
                "$last": "$perekTo"
            },
            "additionals": doc! {
                "$push": doc! {
                    "$cond": doc! {
                        "if": doc! {
                            "$in": [
                                "$name",
                                [
                                    "שמואל א",
                                    "שמואל ב",
                                    "מלכים א",
                                    "מלכים ב",
                                    "דברי הימים א",
                                    "דברי הימים ב",
                                    "עזרא",
                                    "נחמיה"
                                ]
                            ]
                        },
                        "then": "$$ROOT",
                        "else": "$$REMOVE"
                    }
                }
            },
            "perakim": doc! {
                "$first": doc! {
                    "$cond": doc! {
                        "if": doc! {
                            "$in": [
                                "$name",
                                [
                                    "שמואל א",
                                    "שמואל ב",
                                    "מלכים א",
                                    "מלכים ב",
                                    "דברי הימים א",
                                    "דברי הימים ב",
                                    "עזרא",
                                    "נחמיה"
                                ]
                            ]
                        },
                        "then": "$$REMOVE",
                        "else": "$perakim"
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_groups_split_books_and_accumulates_ranges() {
        let stage = build();
        let group = stage.get_document("$group").unwrap();

        assert!(group.get_document("_id").unwrap().contains_key("$switch"));
        assert!(group.get_document("name").unwrap().contains_key("$first"));
        assert_eq!(
            group.get_document("pesukimCount").unwrap().get_str("$sum"),
            Ok("$pesukimCount")
        );
        assert_eq!(
            group.get_document("perekFrom").unwrap().get_str("$first"),
            Ok("$perekFrom")
        );
        assert_eq!(
            group.get_document("perekTo").unwrap().get_str("$last"),
            Ok("$perekTo")
        );
    }

    #[test]
    fn build_routes_split_books_to_additionals_and_regular_books_to_perakim() {
        let stage = build();
        let group = stage.get_document("$group").unwrap();

        let additionals_cond = group
            .get_document("additionals")
            .unwrap()
            .get_document("$push")
            .unwrap()
            .get_document("$cond")
            .unwrap();
        assert_eq!(additionals_cond.get_str("then"), Ok("$$ROOT"));
        assert_eq!(additionals_cond.get_str("else"), Ok("$$REMOVE"));

        let perakim_cond = group
            .get_document("perakim")
            .unwrap()
            .get_document("$first")
            .unwrap()
            .get_document("$cond")
            .unwrap();
        assert_eq!(perakim_cond.get_str("then"), Ok("$$REMOVE"));
        assert_eq!(perakim_cond.get_str("else"), Ok("$perakim"));
    }
}
