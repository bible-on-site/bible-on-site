//! Perek dates stage: Add perekId, header, cycle dates, and star rise times to each perek.
//!
//! This stage enriches each perek with:
//! - `perekId`: Global perek number (1-929)
//! - `header`: Perek header/summary text
//! - `date`: Array of 4 cycle dates (Hebrew date in YYYYMMDD format)
//! - `star_rise`: Array of 4 star rise times (HH:MM format)

use bson::{Bson, Document, doc};

/// Builds the `$set` stage document for perek enrichment.
///
/// # Arguments
/// * `headers_bson` - BSON array of 929 header strings
/// * `dates_bson` - BSON array of 929 date arrays (each with 4 dates)
/// * `star_rise_bson` - BSON array of 929 star rise time arrays (each with 4 HH:MM strings)
pub fn build(headers_bson: Bson, dates_bson: Bson, star_rise_bson: Bson) -> Document {
    doc! {
        "$set": doc! {
            "perekFrom": doc! {
                "$cond": doc! {
                    "if": doc! {
                        "$eq": [
                            "$order",
                            1
                        ]
                    },
                    "then": 1,
                    "else": doc! {
                        "$add": [
                            doc! {
                                "$subtract": [
                                    "$perekTo",
                                    doc! {
                                        "$size": "$perakim"
                                    }
                                ]
                            },
                            1
                        ]
                    }
                }
            },
            "perakim": doc! {
                "$map": doc! {
                    "input": doc! {
                        "$range": [
                            0,
                            doc! {
                                "$size": "$perakim"
                            }
                        ]
                    },
                    "as": "index",
                    "in": doc! {
                        "$let": doc! {
                            "vars": doc! {
                                "perekFromValue": doc! {
                                    "$cond": doc! {
                                        "if": doc! {
                                            "$eq": [
                                                "$order",
                                                1
                                            ]
                                        },
                                        "then": 1,
                                        "else": doc! {
                                            "$add": [
                                                doc! {
                                                    "$subtract": [
                                                        "$perekTo",
                                                        doc! {
                                                            "$size": "$perakim"
                                                        }
                                                    ]
                                                },
                                                1
                                            ]
                                        }
                                    }
                                }
                            },
                            "in": doc! {
                                "$mergeObjects": [
                                    doc! {
                                        "$arrayElemAt": [
                                            "$perakim",
                                            "$$index"
                                        ]
                                    },
                                    doc! {
                                        "perekId": doc! {
                                            "$add": [
                                                "$$perekFromValue",
                                                "$$index"
                                            ]
                                        },
                                        "header": doc! {
                                            "$arrayElemAt": [
                                                headers_bson.clone(),
                                                doc! {
                                                    "$subtract": [
                                                        doc! {
                                                            "$add": [
                                                                "$$perekFromValue",
                                                                "$$index"
                                                            ]
                                                        },
                                                        1
                                                    ]
                                                }
                                            ]
                                        },
                                        "date": doc! {
                                            "$arrayElemAt": [
                                                dates_bson.clone(),
                                                doc! {
                                                    "$subtract": [
                                                        doc! {
                                                            "$add": [
                                                                "$$perekFromValue",
                                                                "$$index"
                                                            ]
                                                        },
                                                        1
                                                    ]
                                                }
                                            ]
                                        },
                                        "star_rise": doc! {
                                            "$arrayElemAt": [
                                                star_rise_bson.clone(),
                                                doc! {
                                                    "$subtract": [
                                                        doc! {
                                                            "$add": [
                                                                "$$perekFromValue",
                                                                "$$index"
                                                            ]
                                                        },
                                                        1
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::bson;

    #[test]
    fn build_sets_first_sefer_perek_from_to_one() {
        let stage = build(bson!(["h1"]), bson!([[57750329]]), bson!([["05:30"]]));
        let set = stage.get_document("$set").unwrap();
        let perek_from = set.get_document("perekFrom").unwrap();
        let condition = perek_from.get_document("$cond").unwrap();

        assert_eq!(condition.get_i32("then"), Ok(1));
        assert_eq!(
            condition
                .get_document("if")
                .unwrap()
                .get_array("$eq")
                .unwrap()
                .first(),
            Some(&Bson::String("$order".to_string()))
        );
    }

    #[test]
    fn build_maps_perakim_with_header_dates_and_star_rise_arrays() {
        let stage = build(
            bson!(["Header 1", "Header 2"]),
            bson!([[57750329], [57750330]]),
            bson!([["05:30"], ["05:31"]]),
        );
        let set = stage.get_document("$set").unwrap();
        let map = set
            .get_document("perakim")
            .unwrap()
            .get_document("$map")
            .unwrap();

        assert_eq!(map.get_str("as"), Ok("index"));
        assert!(
            map.get_document("input")
                .unwrap()
                .get_array("$range")
                .unwrap()
                .contains(&Bson::Int32(0))
        );

        let merge_objects = map
            .get_document("in")
            .unwrap()
            .get_document("$let")
            .unwrap()
            .get_document("in")
            .unwrap()
            .get_array("$mergeObjects")
            .unwrap();
        let enriched = merge_objects[1].as_document().unwrap();
        assert!(enriched.contains_key("perekId"));
        assert!(enriched.contains_key("header"));
        assert!(enriched.contains_key("date"));
        assert!(enriched.contains_key("star_rise"));
    }
}
