//! Offsets stage: Add ktiv/qri offset properties using `$function`.
//!
//! This stage processes segments to compute:
//! - `qriOffset` and `qriSpan` on ktiv segments (pointing to associated qri)
//! - `ktivOffset` and `ktivSpan` on qri segments (pointing back to ktiv)
//! - Removes the internal `_fromBracket` marker

use bson::{doc, Bson, Document};

/// JavaScript function body for processing perakim segments.
///
/// The function:
/// 1. Collects indices of bracket-derived qri segments
/// 2. Pass 1: For each ktiv, counts consecutive bracket qri and sets qriOffset/qriSpan
/// 3. Pass 2: For each bracket qri, finds preceding ktiv and sets ktivOffset/ktivSpan
/// 4. Removes `_fromBracket` marker from all segments
///
/// Regular qri segments (not from brackets) have NO offset properties - this indicates qriAndKtiv
const PROCESS_SEGMENTS_JS: &str = r#"function(perakim) {
    if (!perakim) return perakim;
    return perakim.map(function(perek) {
        perek.pesukim = perek.pesukim.map(function(pasuk) {
            var segs = pasuk.segments;
            var len = segs.length;
            var bracketIndices = {};

            // Collect bracket qri indices
            for (var i = 0; i < len; i++) {
                if (segs[i].type === 'qri' && segs[i]._fromBracket) {
                    bracketIndices[i] = true;
                }
            }

            // Pass 1: ktiv segments - only set offset if there's a matching bracket qri
            for (var i = 0; i < len; i++) {
                if (segs[i].type === 'ktiv') {
                    var qriCount = 0;
                    for (var j = i + 1; j < len && bracketIndices[j]; j++) {
                        qriCount++;
                    }
                    // Only set offset if there's at least one bracket qri following
                    if (qriCount >= 1) {
                        segs[i].qriOffset = 1;
                        if (qriCount > 1) {
                            segs[i].qriSpan = qriCount;
                        }
                    } else {
                        // Orphan ktiv (כתיב ולא קרי) - set offset to 0
                        segs[i].qriOffset = 0;
                    }
                }
            }

            // Pass 2: bracket qri segments - set ktivOffset pointing back
            for (var i = 0; i < len; i++) {
                if (!bracketIndices[i]) continue;

                var ktivIdx = null;
                for (var k = i - 1; k >= 0; k--) {
                    if (segs[k].type === 'ktiv') {
                        ktivIdx = k;
                        break;
                    } else if (bracketIndices[k]) {
                        continue;
                    } else {
                        break;
                    }
                }

                if (ktivIdx !== null) {
                    var distance = i - ktivIdx;
                    segs[i].ktivOffset = -distance;

                    var ktivCount = 0;
                    for (var kk = ktivIdx; kk >= 0 && segs[kk].type === 'ktiv'; kk--) {
                        ktivCount++;
                    }
                    if (ktivCount > 1) {
                        segs[i].ktivSpan = ktivCount;
                    }
                } else {
                    // Orphan bracket qri (קרי ולא כתיב) - set offset to 0
                    segs[i].ktivOffset = 0;
                }

                delete segs[i]._fromBracket;
            }

            // Regular qri (not from bracket) has NO offset properties - this is qriAndKtiv

            return { segments: segs };
        });
        return perek;
    });
}"#;

/// JavaScript function body for processing additionals segments.
const PROCESS_ADDITIONALS_JS: &str = r#"function(additionals) {
    return additionals.map(function(add) {
        add.perakim = add.perakim.map(function(perek) {
            perek.pesukim = perek.pesukim.map(function(pasuk) {
                var segs = pasuk.segments;
                var len = segs.length;
                var bracketIndices = {};

                for (var i = 0; i < len; i++) {
                    if (segs[i].type === 'qri' && segs[i]._fromBracket) {
                        bracketIndices[i] = true;
                    }
                }

                // ktiv segments - only set offset if there's a matching bracket qri
                for (var i = 0; i < len; i++) {
                    if (segs[i].type === 'ktiv') {
                        var qriCount = 0;
                        for (var j = i + 1; j < len && bracketIndices[j]; j++) {
                            qriCount++;
                        }
                        if (qriCount >= 1) {
                            segs[i].qriOffset = 1;
                            if (qriCount > 1) {
                                segs[i].qriSpan = qriCount;
                            }
                        } else {
                            // Orphan ktiv (כתיב ולא קרי) - set offset to 0
                            segs[i].qriOffset = 0;
                        }
                    }
                }

                // bracket qri segments - set ktivOffset pointing back
                for (var i = 0; i < len; i++) {
                    if (!bracketIndices[i]) continue;

                    var ktivIdx = null;
                    for (var k = i - 1; k >= 0; k--) {
                        if (segs[k].type === 'ktiv') {
                            ktivIdx = k;
                            break;
                        } else if (bracketIndices[k]) {
                            continue;
                        } else {
                            break;
                        }
                    }

                    if (ktivIdx !== null) {
                        var distance = i - ktivIdx;
                        segs[i].ktivOffset = -distance;

                        var ktivCount = 0;
                        for (var kk = ktivIdx; kk >= 0 && segs[kk].type === 'ktiv'; kk--) {
                            ktivCount++;
                        }
                        if (ktivCount > 1) {
                            segs[i].ktivSpan = ktivCount;
                        }
                    } else {
                        // Orphan bracket qri (קרי ולא כתיב) - set offset to 0
                        segs[i].ktivOffset = 0;
                    }

                    delete segs[i]._fromBracket;
                }

                return { segments: segs };
            });
            return perek;
        });
        return add;
    });
}"#;

/// Returns the `$set` stage document for ktiv/qri offset computation.
pub fn build() -> Document {
    doc! {
        "$set": doc! {
            "perakim": doc! {
                "$function": doc! {
                    "body": PROCESS_SEGMENTS_JS,
                    "args": ["$perakim"],
                    "lang": "js"
                }
            },
            "additionals": doc! {
                "$cond": doc! {
                    "if": doc! {
                        "$or": [
                            doc! { "$eq": ["$additionals", Bson::Null] },
                            doc! { "$eq": ["$additionals", []] }
                        ]
                    },
                    "then": "$additionals",
                    "else": doc! {
                        "$function": doc! {
                            "body": PROCESS_ADDITIONALS_JS,
                            "args": ["$additionals"],
                            "lang": "js"
                        }
                    }
                }
            }
        }
    }
}
