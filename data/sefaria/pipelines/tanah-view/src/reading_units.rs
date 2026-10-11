//! Shared reading-unit contract — version 1 export parity.
//!
//! A reading division presents the canonical pesukim corpus sliced into
//! units: על הפרק (/929) uses perakim, מסורה על הפרק (/מסורה) uses
//! Masoretic parashot, פרשה על הפרק (/פרשה) uses synagogue Torah
//! parashiot with auxiliary Haftarah readings. Divisions map scripture —
//! they never copy, renumber, or replace canonical verses.
//!
//! This module is the SQLite-side derivation of the same contract the
//! website resolves at runtime from the tanah_view JSON export
//! (web/bible-on-site/src/lib/reading/contract.ts and
//! web/bible-on-site/src/data/masora/masora-units.ts). The parity test
//! at the bottom derives Masoretic units from the checked-in dump JSON
//! and asserts the exact mapping the website produces.
//!
//! See docs/data/reading-units.md for the full contract.

use anyhow::{Result, bail};
use rusqlite::Transaction;
use std::collections::HashMap;

use crate::models::{Perek, Sefer};

/// Contract version shared with the website contract module.
pub const READING_CONTRACT_VERSION: i64 = 1;
pub const MASORA_DIVISION_ID: &str = "masora";
pub const MASORA_ROOT_PATH: &str = "/מסורה";
pub const MASORA_MENU_LABEL: &str = "מסורה על הפרק";

/// A canonical scripture position. `segment_index` is the 0-based index
/// into the pasuk's segment list for precise intra-pasuk bounds;
/// `None` means the whole-pasuk edge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coordinate {
    pub perek_id: i32,
    pub pasuk: i32,
    pub segment_index: Option<i32>,
}

/// An inclusive canonical range. `start` and `end` are both included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptureRange {
    pub start: Coordinate,
    pub end: Coordinate,
}

/// An auxiliary reading attached to a unit (e.g. a Haftarah). Its
/// ranges are ordered, preserving jumps and intentional repeats.
#[derive(Debug, Clone)]
pub struct AuxiliaryReading {
    pub id: String,
    pub label: String,
    pub ranges: Vec<ScriptureRange>,
}

/// A reading unit — the addressable entry inside a division.
#[derive(Debug, Clone)]
pub struct ReadingUnit {
    /// Stable unit id, unique and contiguous within the division.
    pub unit_id: i32,
    /// URL slug under the division root (today the decimal unit_id).
    pub slug: String,
    /// Parent sefer id (1-based, matching tanah_sefer.id).
    pub sefer_id: i32,
    /// 1-based order of this unit inside its sefer.
    pub order: i32,
    /// Display heading (scripture reference span).
    pub heading: String,
    /// Primary reading ranges in order.
    pub ranges: Vec<ScriptureRange>,
    /// Auxiliary readings such as Haftarot, when present.
    pub auxiliary_readings: Vec<AuxiliaryReading>,
    /// The boundary break that closes this unit ("ptuha"/"stuma"), or
    /// None for the final unit of a sefer (closed by the sefer end).
    pub closing_break: Option<&'static str>,
}

/// Hebrew numeral letters — port of gematry's `toLetters` used by the
/// website. Greedy digits with repeated ת above 400; a remainder of
/// exactly 15/16 becomes טו/טז.
pub fn to_letters(n: i32) -> String {
    const DIGITS: [(i32, &str); 22] = [
        (400, "ת"),
        (300, "ש"),
        (200, "ר"),
        (100, "ק"),
        (90, "צ"),
        (80, "פ"),
        (70, "ע"),
        (60, "ס"),
        (50, "נ"),
        (40, "מ"),
        (30, "ל"),
        (20, "כ"),
        (10, "י"),
        (9, "ט"),
        (8, "ח"),
        (7, "ז"),
        (6, "ו"),
        (5, "ה"),
        (4, "ד"),
        (3, "ג"),
        (2, "ב"),
        (1, "א"),
    ];
    assert!(n > 0, "to_letters expects a positive number, got {n}");
    let mut result = String::new();
    let mut remaining = n;
    while remaining > 0 {
        match remaining {
            15 => {
                result.push_str("טו");
                break;
            }
            16 => {
                result.push_str("טז");
                break;
            }
            _ => {}
        }
        for &(value, letter) in &DIGITS {
            if value <= remaining {
                result.push_str(letter);
                remaining -= value;
                break;
            }
        }
    }
    result
}

/// Perakim part — a contiguous run of perakim within a sefer, either the
/// sefer itself or one additional (שמואל א/ב etc.).
struct PerakimPart<'a> {
    perek_from: i32,
    perek_to: i32,
    letter: Option<&'a str>,
    perakim: &'a [Perek],
}

fn sefer_perakim_parts(sefer: &Sefer) -> Vec<PerakimPart<'_>> {
    if let Some(perakim) = &sefer.perakim {
        vec![PerakimPart {
            perek_from: sefer.perek_from,
            perek_to: sefer.perek_to,
            letter: None,
            perakim,
        }]
    } else {
        sefer
            .additionals
            .as_ref()
            .map(|additionals| {
                additionals
                    .iter()
                    .map(|additional| PerakimPart {
                        perek_from: additional.perek_from,
                        perek_to: additional.perek_to,
                        letter: Some(additional.letter.as_str()),
                        perakim: &additional.perakim,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Lookup info for a canonical perek id: owning sefer, optional
/// additional letter, and the perek's number inside its part.
struct PerekInfo {
    sefer_index: usize,
    letter: Option<String>,
    perek_num: i32,
}

fn build_perek_index(sefarim: &[Sefer]) -> HashMap<i32, PerekInfo> {
    let mut index = HashMap::new();
    for (sefer_index, sefer) in sefarim.iter().enumerate() {
        for part in sefer_perakim_parts(sefer) {
            for (pi, perek) in part.perakim.iter().enumerate() {
                let perek_id = part.perek_from + pi as i32;
                let _ = perek; // id derives from part range, matching the website
                index.insert(
                    perek_id,
                    PerekInfo {
                        sefer_index,
                        letter: part.letter.map(str::to_string),
                        perek_num: perek_id - part.perek_from + 1,
                    },
                );
            }
        }
    }
    index
}

/// The perek's source reference, e.g. "בראשית א" or "שמואל א יב".
fn perek_source(
    coordinate: &Coordinate,
    sefarim: &[Sefer],
    index: &HashMap<i32, PerekInfo>,
) -> String {
    let info = index
        .get(&coordinate.perek_id)
        .unwrap_or_else(|| panic!("No perek found for perekId: {}", coordinate.perek_id));
    let sefer_name = &sefarim[info.sefer_index].name;
    let perek_heb = to_letters(info.perek_num);
    match &info.letter {
        Some(letter) => format!("{sefer_name} {letter} {perek_heb}"),
        None => format!("{sefer_name} {perek_heb}"),
    }
}

/// Display heading for a unit — port of `formatMasoraUnitHeading`.
/// Same-perek units collapse to "שמואל א יב ה-ז"; cross-perek units keep
/// both endpoints ("בראשית לה כב - מ א").
fn format_masora_heading(
    start: &Coordinate,
    end: &Coordinate,
    sefarim: &[Sefer],
    index: &HashMap<i32, PerekInfo>,
) -> String {
    // The start ref is "source pasuk": perek_source already carries the
    // perek letters ("בראשית א"), so append the pasuk letters
    // ("בראשית א א"), matching the website's perekRefOf.
    let start_ref = format!(
        "{} {}",
        perek_source(start, sefarim, index),
        to_letters(start.pasuk)
    );
    if start.perek_id == end.perek_id {
        return if start.pasuk == end.pasuk {
            start_ref
        } else {
            format!("{start_ref}-{}", to_letters(end.pasuk))
        };
    }
    let end_info = index
        .get(&end.perek_id)
        .unwrap_or_else(|| panic!("No perek found for perekId: {}", end.perek_id));
    let end_perek_heb = to_letters(end_info.perek_num);
    let end_context = match &end_info.letter {
        Some(letter) => format!("{letter} {end_perek_heb}"),
        None => end_perek_heb,
    };
    format!("{start_ref} - {end_context} {}", to_letters(end.pasuk))
}

/// The coordinate that opens the unit after a break marker — port of
/// `coordinateAfterMarker`.
fn coordinate_after_marker(
    perek_id: i32,
    pasuk_idx: usize,
    marker_idx: usize,
    perek: &Perek,
    next_perek_id: Option<i32>,
) -> Result<Coordinate> {
    let pasuk = &perek.pesukim[pasuk_idx];
    if marker_idx + 1 < pasuk.segments.len() {
        return Ok(Coordinate {
            perek_id,
            pasuk: pasuk_idx as i32 + 1,
            segment_index: Some(marker_idx as i32 + 1),
        });
    }
    if pasuk_idx + 1 < perek.pesukim.len() {
        return Ok(Coordinate {
            perek_id,
            pasuk: pasuk_idx as i32 + 2,
            segment_index: None,
        });
    }
    // A break at the very end of a perek: the next unit opens the next
    // perek (perakim ids are contiguous across a sefer's additionals).
    match next_perek_id {
        Some(next) => Ok(Coordinate {
            perek_id: next,
            pasuk: 1,
            segment_index: None,
        }),
        None => bail!("Masora break after final pasuk of sefer (perekId {perek_id})"),
    }
}

/// Derive the מסורה division's units from the canonical corpus — port
/// of `deriveUnitsFromSefarim`. Every `ptuha`/`stuma` segment closes the
/// preceding unit; the text after the marker starts the next. A sefer's
/// last unit is closed by the sefer end with `closing_break: None`.
/// Unit ids are globally contiguous; `order` is 1-based per sefer.
pub fn derive_masora_units(sefarim: &[Sefer]) -> Result<Vec<ReadingUnit>> {
    let index = build_perek_index(sefarim);
    let mut units = Vec::new();
    let mut next_unit_id = 1i32;

    for (sefer_idx, sefer) in sefarim.iter().enumerate() {
        let sefer_id = sefer_idx as i32 + 1;
        let parts = sefer_perakim_parts(sefer);
        let Some(first_part) = parts.first() else {
            continue;
        };
        let sefer_start = Coordinate {
            perek_id: first_part.perek_from,
            pasuk: 1,
            segment_index: None,
        };
        let mut pending_start: Option<Coordinate> = None;
        let mut order = 0i32;

        // emit() equivalent — appends one unit spanning start..=end.
        macro_rules! emit {
            ($end:expr, $closing_break:expr) => {{
                let start = pending_start.clone().unwrap_or_else(|| sefer_start.clone());
                order += 1;
                units.push(ReadingUnit {
                    unit_id: next_unit_id,
                    slug: next_unit_id.to_string(),
                    sefer_id,
                    order,
                    heading: format_masora_heading(&start, &$end, sefarim, &index),
                    ranges: vec![ScriptureRange { start, end: $end }],
                    auxiliary_readings: Vec::new(),
                    closing_break: $closing_break,
                });
                next_unit_id += 1;
            }};
        }

        for (part_idx, part) in parts.iter().enumerate() {
            for (pi, perek) in part.perakim.iter().enumerate() {
                let perek_id = part.perek_from + pi as i32;
                // The perek after this one, within the same sefer.
                let is_last_perek_of_part = pi == part.perakim.len() - 1;
                let is_last_part = part_idx == parts.len() - 1;
                let next_perek_id = if is_last_perek_of_part {
                    if is_last_part {
                        None
                    } else {
                        Some(parts[part_idx + 1].perek_from)
                    }
                } else {
                    Some(perek_id + 1)
                };
                for (vi, pasuk) in perek.pesukim.iter().enumerate() {
                    for (si, segment) in pasuk.segments.iter().enumerate() {
                        let seg_type = segment.segment_type.as_str();
                        if seg_type != "ptuha" && seg_type != "stuma" {
                            continue;
                        }
                        let closing_break: &'static str = if seg_type == "ptuha" {
                            "ptuha"
                        } else {
                            "stuma"
                        };
                        emit!(
                            Coordinate {
                                perek_id,
                                pasuk: vi as i32 + 1,
                                segment_index: Some(si as i32),
                            },
                            Some(closing_break)
                        );
                        pending_start = Some(coordinate_after_marker(
                            perek_id,
                            vi,
                            si,
                            perek,
                            next_perek_id,
                        )?);
                    }
                }
            }
        }

        let last_part = parts.last().expect("parts is non-empty");
        let last_perek = last_part.perakim.last().expect("part has perakim");
        emit!(
            Coordinate {
                perek_id: last_part.perek_to,
                pasuk: last_perek.pesukim.len() as i32,
                segment_index: None,
            },
            None
        );
    }

    Ok(units)
}

/// Insert the מסורה division row plus all its units and ranges into the
/// reading-unit tables declared in tanah_structure.sql.
pub fn insert_masora_reading_units(tx: &Transaction, sefarim: &[Sefer]) -> Result<()> {
    tx.execute(
        "INSERT INTO tanah_reading_division (id, contract_version, root_path, menu_label)
         VALUES (?1, ?2, ?3, ?4)",
        (
            MASORA_DIVISION_ID,
            READING_CONTRACT_VERSION,
            MASORA_ROOT_PATH,
            MASORA_MENU_LABEL,
        ),
    )?;

    let units = derive_masora_units(sefarim)?;
    for unit in &units {
        tx.execute(
            "INSERT INTO tanah_reading_unit
             (division_id, unit_id, slug, sefer_id, unit_order, heading, closing_break)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                MASORA_DIVISION_ID,
                unit.unit_id,
                &unit.slug,
                unit.sefer_id,
                unit.order,
                &unit.heading,
                unit.closing_break,
            ),
        )?;

        for (range_index, range) in unit.ranges.iter().enumerate() {
            insert_range(
                tx,
                unit.unit_id,
                range_index as i32,
                None,
                None,
                None,
                range,
            )?;
        }
        for (aux_ordinal, aux) in unit.auxiliary_readings.iter().enumerate() {
            for (range_index, range) in aux.ranges.iter().enumerate() {
                insert_range(
                    tx,
                    unit.unit_id,
                    range_index as i32,
                    Some(aux_ordinal as i32),
                    Some(&aux.id),
                    Some(&aux.label),
                    range,
                )?;
            }
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_range(
    tx: &Transaction,
    unit_id: i32,
    range_index: i32,
    auxiliary_ordinal: Option<i32>,
    auxiliary_id: Option<&str>,
    auxiliary_label: Option<&str>,
    range: &ScriptureRange,
) -> Result<()> {
    tx.execute(
        "INSERT INTO tanah_reading_unit_range
         (division_id, unit_id, range_index, auxiliary_ordinal, auxiliary_id, auxiliary_label,
          start_perek_id, start_pasuk, start_segment_index,
          end_perek_id, end_pasuk, end_segment_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        (
            MASORA_DIVISION_ID,
            unit_id,
            range_index,
            auxiliary_ordinal,
            auxiliary_id,
            auxiliary_label,
            range.start.perek_id,
            range.start.pasuk,
            range.start.segment_index,
            range.end.perek_id,
            range.end.pasuk,
            range.end.segment_index,
        ),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Additional, Pasuk, Segment};
    use rusqlite::Connection;
    use std::fs;
    use std::path::Path;

    fn text_segment() -> Segment {
        Segment {
            value: Some("word".to_string()),
            segment_type: "qri".to_string(),
            recording_time_frame: None,
            ktiv_offset: None,
            qri_offset: None,
        }
    }

    fn marker(segment_type: &str) -> Segment {
        Segment {
            value: None,
            segment_type: segment_type.to_string(),
            recording_time_frame: None,
            ktiv_offset: None,
            qri_offset: None,
        }
    }

    fn pasuk(segments: Vec<Segment>) -> Pasuk {
        Pasuk { segments }
    }

    fn text_pasuk() -> Pasuk {
        pasuk(vec![text_segment(), text_segment()])
    }

    fn perek(perek_id: i32, pesukim: Vec<Pasuk>) -> Perek {
        Perek {
            recitation: None,
            perek_id,
            header: format!("Header {perek_id}"),
            date: vec![],
            star_rise: vec![],
            pesukim,
        }
    }

    #[test]
    fn to_letters_matches_gematry_conventions() {
        let cases = [
            (1, "א"),
            (2, "ב"),
            (5, "ה"),
            (12, "יב"),
            (15, "טו"),
            (16, "טז"),
            (19, "יט"),
            (22, "כב"),
            (30, "ל"),
            (115, "קטו"),
            (116, "קטז"),
            (119, "קיט"),
            (150, "קנ"),
            (176, "קעו"),
            (400, "ת"),
            (500, "תק"),
            (760, "תשס"),
            (999, "תתקצט"),
            (1000, "תתר"),
        ];
        for (n, expected) in cases {
            assert_eq!(to_letters(n), expected, "to_letters({n})");
        }
    }

    /// Two-perakim corpus where a mid-pasuk marker splits a unit inside
    /// a pasuk and an end-of-perek marker opens the next perek.
    fn masora_sample_sefarim() -> Vec<Sefer> {
        vec![
            Sefer {
                id: "book-a".to_string(),
                name: "בראשית".to_string(),
                tanach_us_name: None,
                helek: "תורה".to_string(),
                pesukim_count: 5,
                perek_from: 1,
                perek_to: 2,
                additionals: None,
                perakim: Some(vec![
                    perek(
                        1,
                        vec![
                            // pasuk 1: text, mid-pasuk marker, more text
                            pasuk(vec![text_segment(), marker("stuma"), text_segment()]),
                            // pasuk 2: plain
                            text_pasuk(),
                            // pasuk 3: marker at the last segment
                            pasuk(vec![text_segment(), marker("ptuha")]),
                        ],
                    ),
                    perek(
                        2,
                        vec![
                            // pasuk 1: end-of-perek marker
                            pasuk(vec![text_segment(), marker("stuma")]),
                            // pasuk 2: trailing text (sefer-end unit)
                            text_pasuk(),
                        ],
                    ),
                ]),
            },
            // A sefer split into additionals: marker ending the last
            // pasuk of א opens the first perek of ב.
            Sefer {
                id: "book-b".to_string(),
                name: "שמואל".to_string(),
                tanach_us_name: None,
                helek: "נביאים".to_string(),
                pesukim_count: 4,
                perek_from: 3,
                perek_to: 4,
                additionals: Some(vec![
                    Additional {
                        letter: "א".to_string(),
                        name: "שמואל א".to_string(),
                        tanach_us_name: None,
                        helek: "נביאים".to_string(),
                        order: 1,
                        pesukim_count: 2,
                        perek_from: 3,
                        perek_to: 3,
                        perakim: vec![perek(
                            3,
                            vec![pasuk(vec![text_segment(), text_segment(), marker("ptuha")])],
                        )],
                    },
                    Additional {
                        letter: "ב".to_string(),
                        name: "שמואל ב".to_string(),
                        tanach_us_name: None,
                        helek: "נביאים".to_string(),
                        order: 2,
                        pesukim_count: 2,
                        perek_from: 4,
                        perek_to: 4,
                        perakim: vec![perek(4, vec![text_pasuk(), text_pasuk()])],
                    },
                ]),
                perakim: None,
            },
        ]
    }

    #[test]
    fn derive_masora_units_maps_breaks_and_boundaries() {
        let units = derive_masora_units(&masora_sample_sefarim()).unwrap();
        // 4 units in בראשית + 2 units in שמואל.
        assert_eq!(units.len(), 6);

        // Unit 1: perek 1 pasuk 1, ends mid-pasuk at the stuma marker.
        assert_eq!(units[0].unit_id, 1);
        assert_eq!(units[0].sefer_id, 1);
        assert_eq!(units[0].order, 1);
        assert_eq!(units[0].closing_break, Some("stuma"));
        assert_eq!(
            units[0].ranges[0],
            ScriptureRange {
                start: Coordinate {
                    perek_id: 1,
                    pasuk: 1,
                    segment_index: None,
                },
                end: Coordinate {
                    perek_id: 1,
                    pasuk: 1,
                    segment_index: Some(1),
                },
            }
        );
        assert_eq!(units[0].heading, "בראשית א א");

        // Unit 2: rest of pasuk 1 through the marker ending pasuk 3.
        assert_eq!(units[1].closing_break, Some("ptuha"));
        assert_eq!(
            units[1].ranges[0].start,
            Coordinate {
                perek_id: 1,
                pasuk: 1,
                segment_index: Some(2),
            }
        );
        assert_eq!(
            units[1].ranges[0].end,
            Coordinate {
                perek_id: 1,
                pasuk: 3,
                segment_index: Some(1),
            }
        );
        assert_eq!(units[1].heading, "בראשית א א-ג");

        // Unit 3: whole pasuk 1 of perek 2, closed by stuma.
        assert_eq!(units[2].closing_break, Some("stuma"));
        assert_eq!(
            units[2].ranges[0],
            ScriptureRange {
                start: Coordinate {
                    perek_id: 2,
                    pasuk: 1,
                    segment_index: None,
                },
                end: Coordinate {
                    perek_id: 2,
                    pasuk: 1,
                    segment_index: Some(1),
                },
            }
        );
        assert_eq!(units[2].heading, "בראשית ב א");

        // Unit 4: sefer-end unit of בראשית, no closing break.
        assert_eq!(units[3].closing_break, None);
        assert_eq!(units[3].order, 4);
        assert_eq!(
            units[3].ranges[0],
            ScriptureRange {
                start: Coordinate {
                    perek_id: 2,
                    pasuk: 2,
                    segment_index: None,
                },
                end: Coordinate {
                    perek_id: 2,
                    pasuk: 2,
                    segment_index: None,
                },
            }
        );
        assert_eq!(units[3].heading, "בראשית ב ב");

        // Unit 5: שמואל's first unit opens at sefer start (first perek
        // of additional א) and is closed by the ptuha at the last pasuk
        // of that additional.
        assert_eq!(units[4].sefer_id, 2);
        assert_eq!(units[4].order, 1);
        assert_eq!(units[4].closing_break, Some("ptuha"));
        assert_eq!(
            units[4].ranges[0].end,
            Coordinate {
                perek_id: 3,
                pasuk: 1,
                segment_index: Some(2),
            }
        );
        assert_eq!(units[4].heading, "שמואל א א א");

        // Unit 6: the break at the end of additional א opens the unit
        // at perek 4 (first perek of additional ב); closed by sefer end.
        assert_eq!(units[5].sefer_id, 2);
        assert_eq!(units[5].order, 2);
        assert_eq!(units[5].closing_break, None);
        assert_eq!(
            units[5].ranges[0],
            ScriptureRange {
                start: Coordinate {
                    perek_id: 4,
                    pasuk: 1,
                    segment_index: None,
                },
                end: Coordinate {
                    perek_id: 4,
                    pasuk: 2,
                    segment_index: None,
                },
            }
        );
        assert_eq!(units[5].heading, "שמואל ב א א-ב");
    }

    #[test]
    fn derive_masora_units_rejects_marker_after_final_pasuk() {
        let sefarim = vec![Sefer {
            id: "book-a".to_string(),
            name: "בראשית".to_string(),
            tanach_us_name: None,
            helek: "תורה".to_string(),
            pesukim_count: 1,
            perek_from: 1,
            perek_to: 1,
            additionals: None,
            perakim: Some(vec![perek(
                1,
                vec![pasuk(vec![text_segment(), marker("stuma")])],
            )]),
        }];
        let err = derive_masora_units(&sefarim).unwrap_err();
        assert!(err.to_string().contains("final pasuk of sefer"));
    }

    #[test]
    fn insert_masora_reading_units_writes_division_units_and_ranges() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tanah_reading_division (
                id TEXT PRIMARY KEY,
                contract_version INTEGER NOT NULL,
                root_path TEXT NOT NULL,
                menu_label TEXT NOT NULL
            );
            CREATE TABLE tanah_reading_unit (
                division_id TEXT NOT NULL,
                unit_id INTEGER NOT NULL,
                slug TEXT NOT NULL,
                sefer_id INTEGER NOT NULL,
                unit_order INTEGER NOT NULL,
                heading TEXT NOT NULL,
                closing_break TEXT,
                PRIMARY KEY (division_id, unit_id)
            );
            CREATE TABLE tanah_reading_unit_range (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                division_id TEXT NOT NULL,
                unit_id INTEGER NOT NULL,
                range_index INTEGER NOT NULL,
                auxiliary_ordinal INTEGER,
                auxiliary_id TEXT,
                auxiliary_label TEXT,
                start_perek_id INTEGER NOT NULL,
                start_pasuk INTEGER NOT NULL,
                start_segment_index INTEGER,
                end_perek_id INTEGER NOT NULL,
                end_pasuk INTEGER NOT NULL,
                end_segment_index INTEGER
            );",
        )
        .unwrap();

        let tx = conn.transaction().unwrap();
        insert_masora_reading_units(&tx, &masora_sample_sefarim()).unwrap();
        tx.commit().unwrap();

        let division: (String, i64, String, String) = conn
            .query_row(
                "SELECT id, contract_version, root_path, menu_label
                 FROM tanah_reading_division WHERE id = 'masora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            division,
            (
                MASORA_DIVISION_ID.to_string(),
                READING_CONTRACT_VERSION,
                MASORA_ROOT_PATH.to_string(),
                MASORA_MENU_LABEL.to_string(),
            )
        );

        let unit_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_reading_unit", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(unit_count, 6);

        let range_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_reading_unit_range WHERE auxiliary_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(range_count, 6);

        // Intra-pasuk bound round-trips through the range table.
        let mid_bound: (i64, Option<i64>) = conn
            .query_row(
                "SELECT start_segment_index, end_segment_index
                 FROM tanah_reading_unit_range WHERE unit_id = 2",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(mid_bound, (2, Some(1)));
    }

    /// Export parity: derive from the checked-in tanah_view dump (the
    /// exact JSON the website consumes via src/data/db/sefarim) and
    /// assert the mapping the website's masora-units.ts produces.
    #[test]
    fn masora_derivation_matches_website_export_parity() {
        let corpus_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../../../web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
        );
        let json = fs::read_to_string(&corpus_path)
            .unwrap_or_else(|e| panic!("Failed to read corpus {}: {e}", corpus_path.display()));
        let sefarim: Vec<Sefer> = serde_json::from_str(&json).unwrap();

        let units = derive_masora_units(&sefarim).unwrap();

        // Counts produced by the website's getAllMasoraUnits() on the
        // same dump (verified via src/data/masora/masora-units.ts).
        assert_eq!(units.len(), 3197);
        assert_eq!(sefarim.len(), 35);

        let ptuha = units
            .iter()
            .filter(|u| u.closing_break == Some("ptuha"))
            .count();
        let stuma = units
            .iter()
            .filter(|u| u.closing_break == Some("stuma"))
            .count();
        let sefer_end = units.iter().filter(|u| u.closing_break.is_none()).count();
        assert_eq!(ptuha, 1181);
        assert_eq!(stuma, 1981);
        assert_eq!(sefer_end, 35);

        let cross_perek = units
            .iter()
            .filter(|u| u.ranges[0].start.perek_id != u.ranges[0].end.perek_id)
            .count();
        assert_eq!(cross_perek, 153);

        // Slugs are contiguous decimal ids; per-sefer order resets.
        for (i, unit) in units.iter().enumerate() {
            assert_eq!(unit.unit_id, i as i32 + 1);
            assert_eq!(unit.slug, (i as i32 + 1).to_string());
        }
        assert_eq!(units[0].order, 1);
        assert_eq!(units[93 - 1].sefer_id, 1);
        assert_eq!(units[93].sefer_id, 2); // שמואל starts unit 94

        // Spot-check headings the website formats identically.
        assert_eq!(units[0].heading, "בראשית א א-ה");
        assert_eq!(units[49].heading, "בראשית יז טו-כז");
        assert_eq!(units[3196].heading, "דברי הימים ב לו כג");
        assert_eq!(units[3196].closing_break, None);

        // First unit's range endpoints, including the intra-pasuk bound.
        assert_eq!(
            units[0].ranges[0],
            ScriptureRange {
                start: Coordinate {
                    perek_id: 1,
                    pasuk: 1,
                    segment_index: None,
                },
                end: Coordinate {
                    perek_id: 1,
                    pasuk: 5,
                    segment_index: Some(13),
                },
            }
        );
    }
}
