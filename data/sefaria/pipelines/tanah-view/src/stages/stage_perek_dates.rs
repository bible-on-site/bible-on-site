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
