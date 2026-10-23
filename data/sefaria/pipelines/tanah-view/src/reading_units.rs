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

use anyhow::{Context, Result, bail};
use rusqlite::Transaction;
use std::collections::HashMap;
use std::path::Path;

use crate::models::{Perek, Sefer};

/// Contract version shared with the website contract module.
pub const READING_CONTRACT_VERSION: i64 = 1;
pub const MASORA_DIVISION_ID: &str = "masora";
pub const MASORA_ROOT_PATH: &str = "/מסורה";
pub const MASORA_MENU_LABEL: &str = "מסורה על הפרק";
pub const PARASHA_DIVISION_ID: &str = "parasha";

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
    perakim: &'a [Perek],
}

fn sefer_perakim_parts(sefer: &Sefer) -> Vec<PerakimPart<'_>> {
    if let Some(perakim) = &sefer.perakim {
        vec![PerakimPart {
            perek_from: sefer.perek_from,
            perek_to: sefer.perek_to,
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
                        perakim: &additional.perakim,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Display heading for a unit — port of `formatMasoraUnitHeading`:
/// the Masoretic parasha identity (sefer name + the unit's 1-based
/// ordinal inside its sefer, e.g. "בראשית פרשה ח"). Conventional
/// perek/pasuk references stay internal and never surface in the
/// מסורה reader chrome.
fn format_masora_heading(sefer_name: &str, order: i32) -> String {
    format!("{sefer_name} פרשה {}", to_letters(order))
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
                    heading: format_masora_heading(&sefer.name, order),
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
    insert_units(tx, MASORA_DIVISION_ID, &units)
}

/// Insert one division's units — every unit row, its ordered primary
/// ranges (auxiliary columns NULL), and each auxiliary reading's ranges
/// keyed by (auxiliary_ordinal, auxiliary_id). The unit shape is shared
/// across divisions; only the derive step differs between them.
fn insert_units(tx: &Transaction, division_id: &str, units: &[ReadingUnit]) -> Result<()> {
    for unit in units {
        tx.execute(
            "INSERT INTO tanah_reading_unit
             (division_id, unit_id, slug, sefer_id, unit_order, heading, closing_break)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                division_id,
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
                division_id,
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
                    division_id,
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
    division_id: &str,
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
            division_id,
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

// ===== פרשה על הפרק — the synagogue Torah parasha division =====
//
// Unlike מסורה (derived from corpus break markers), the weekly
// parashiot come from a curated source table shared verbatim with the
// website: web/bible-on-site/src/data/parasha/parasha-division.json.
// This module resolves that table's (sefer, printed perek, pasuk)
// references to canonical perekId coordinates — the exact resolution
// parasha-units.ts performs at module load — so the SQLite export and
// the website stay in parity.

/// Source-table mirror of parasha-division.json. Only the fields the
/// export needs are modeled; `occasions` are landing-page reference
/// data, not reading units.
#[derive(Debug, serde::Deserialize)]
pub struct ParashaDivisionSource {
    #[serde(rename = "rootPath")]
    pub root_path: String,
    #[serde(rename = "menuLabel")]
    pub menu_label: String,
    pub customs: HashMap<String, String>,
    pub units: Vec<ParashaSourceUnit>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ParashaSourceUnit {
    pub name: String,
    pub sefer: String,
    pub start: SourceVerse,
    pub end: SourceVerse,
    #[serde(default)]
    pub haftarot: Vec<SourceHaftara>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SourceVerse {
    pub perek: i32,
    pub pasuk: i32,
}

#[derive(Debug, serde::Deserialize)]
pub struct SourceRange {
    pub sefer: String,
    pub additional: Option<String>,
    pub start: SourceVerse,
    pub end: SourceVerse,
}

#[derive(Debug, serde::Deserialize)]
pub struct SourceHaftara {
    pub customs: Vec<String>,
    pub ranges: Vec<SourceRange>,
}

/// The (perek_from, perek_to) span of a sefer part named in the source
/// table — the sefer itself or one additional (מלכים א etc.).
fn sefer_part_range(
    sefarim: &[Sefer],
    sefer_name: &str,
    additional: Option<&str>,
) -> Result<(i32, i32)> {
    let sefer = sefarim
        .iter()
        .find(|s| s.name == sefer_name)
        .ok_or_else(|| anyhow::anyhow!("parasha data: unknown sefer \"{sefer_name}\""))?;
    match additional {
        None => {
            if sefer.additionals.is_some() {
                bail!(
                    "parasha data: \"{sefer_name}\" is split into additionals; \"additional\" is required"
                );
            }
            Ok((sefer.perek_from, sefer.perek_to))
        }
        Some(letter) => {
            let part = sefer
                .additionals
                .as_ref()
                .ok_or_else(|| {
                    anyhow::anyhow!("parasha data: \"{sefer_name}\" has no additional \"{letter}\"")
                })?
                .iter()
                .find(|a| a.letter == letter)
                .ok_or_else(|| {
                    anyhow::anyhow!("parasha data: \"{sefer_name}\" has no additional \"{letter}\"")
                })?;
            Ok((part.perek_from, part.perek_to))
        }
    }
}

/// Canonical pasuk count of a perek id, resolved over sefer parts.
fn parasha_pasuk_count(sefarim: &[Sefer], perek_id: i32) -> Result<i32> {
    for sefer in sefarim {
        for part in sefer_perakim_parts(sefer) {
            if perek_id >= part.perek_from && perek_id <= part.perek_to {
                return Ok(part.perakim[(perek_id - part.perek_from) as usize]
                    .pesukim
                    .len() as i32);
            }
        }
    }
    bail!("parasha data: unknown perekId {perek_id}");
}

/// Resolve one printed reference to canonical coordinates — port of the
/// website's resolveVerse, including its bounds validation.
fn resolve_parasha_verse(
    sefarim: &[Sefer],
    range: &SourceRange,
    verse: &SourceVerse,
) -> Result<Coordinate> {
    let (perek_from, perek_to) =
        sefer_part_range(sefarim, &range.sefer, range.additional.as_deref())?;
    let perek_id = perek_from + verse.perek - 1;
    let display = format!(
        "{}{} {}",
        range.sefer,
        range
            .additional
            .as_ref()
            .map(|a| format!(" {a}"))
            .unwrap_or_default(),
        verse.perek,
    );
    if perek_id > perek_to {
        bail!(
            "parasha data: {display} exceeds {}'s perek count",
            range.sefer
        );
    }
    let pasuk_count = parasha_pasuk_count(sefarim, perek_id)?;
    if verse.pasuk < 1 || verse.pasuk > pasuk_count {
        bail!(
            "parasha data: {display}:{} is outside the canonical {pasuk_count} pesukim",
            verse.pasuk
        );
    }
    Ok(Coordinate {
        perek_id,
        pasuk: verse.pasuk,
        segment_index: None,
    })
}

fn resolve_parasha_range(sefarim: &[Sefer], range: &SourceRange) -> Result<ScriptureRange> {
    let resolved = ScriptureRange {
        start: resolve_parasha_verse(sefarim, range, &range.start)?,
        end: resolve_parasha_verse(sefarim, range, &range.end)?,
    };
    // Backwards ranges are impossible endpoints, not reading order —
    // ordered multi-range lists stay untouched (jumps are legal).
    if resolved.start.perek_id > resolved.end.perek_id
        || (resolved.start.perek_id == resolved.end.perek_id
            && resolved.start.pasuk > resolved.end.pasuk)
    {
        bail!(
            "parasha data: backwards range in {} {}:{} - {}:{}",
            range.sefer,
            range.start.perek,
            range.start.pasuk,
            range.end.perek,
            range.end.pasuk,
        );
    }
    Ok(resolved)
}

/// Port of the website's haftaraId: `haftara-{customs-joined}`.
fn haftara_id(customs: &[String]) -> String {
    format!("haftara-{}", customs.join("-"))
}

/// Port of the website's haftaraLabel: custom labels with a Hebrew
/// conjunction before the last ("ספרדים ותימנים").
fn haftara_label(customs: &[String], labels: &HashMap<String, String>) -> String {
    let names: Vec<String> = customs
        .iter()
        .map(|custom| {
            labels
                .get(custom)
                .cloned()
                .unwrap_or_else(|| custom.clone())
        })
        .collect();
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        2 => format!("{} ו{}", names[0], names[1]),
        n => format!("{} ו{}", names[..n - 1].join(", "), names[n - 1]),
    }
}

/// Resolve the parasha source table into contract units — port of
/// parasha-units.ts `deriveUnits`: positional unit ids, per-sefer order,
/// the parasha name as heading, one primary Torah range, and every
/// Haftarah custom as an ordered auxiliary reading.
pub fn derive_parasha_units(
    source: &ParashaDivisionSource,
    sefarim: &[Sefer],
) -> Result<Vec<ReadingUnit>> {
    let mut units = Vec::with_capacity(source.units.len());
    let mut order_by_sefer: HashMap<&str, i32> = HashMap::new();

    for (index, parasha) in source.units.iter().enumerate() {
        let order = order_by_sefer.entry(parasha.sefer.as_str()).or_insert(0);
        *order += 1;
        let order = *order;

        let primary_range = resolve_parasha_range(
            sefarim,
            &SourceRange {
                sefer: parasha.sefer.clone(),
                additional: None,
                start: SourceVerse {
                    perek: parasha.start.perek,
                    pasuk: parasha.start.pasuk,
                },
                end: SourceVerse {
                    perek: parasha.end.perek,
                    pasuk: parasha.end.pasuk,
                },
            },
        )?;

        let mut auxiliary_readings = Vec::with_capacity(parasha.haftarot.len());
        for haftara in &parasha.haftarot {
            let ranges = haftara
                .ranges
                .iter()
                .map(|range| resolve_parasha_range(sefarim, range))
                .collect::<Result<Vec<_>>>()?;
            auxiliary_readings.push(AuxiliaryReading {
                id: haftara_id(&haftara.customs),
                label: haftara_label(&haftara.customs, &source.customs),
                ranges,
            });
        }

        let sefer_id = sefarim
            .iter()
            .position(|s| s.name == parasha.sefer)
            .ok_or_else(|| anyhow::anyhow!("parasha data: unknown sefer \"{}\"", parasha.sefer))?
            as i32
            + 1;

        let unit_id = index as i32 + 1;
        units.push(ReadingUnit {
            unit_id,
            slug: unit_id.to_string(),
            sefer_id,
            order,
            heading: parasha.name.clone(),
            ranges: vec![primary_range],
            auxiliary_readings,
            closing_break: None,
        });
    }
    Ok(units)
}

/// Path of the shared source table the website also consumes.
pub fn parasha_division_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../web/bible-on-site/src/data/parasha/parasha-division.json")
}

/// Load and parse the shared parasha source table.
pub fn load_parasha_division() -> Result<ParashaDivisionSource> {
    let path = parasha_division_path();
    let json = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read parasha division {}", path.display()))?;
    serde_json::from_str(&json)
        .with_context(|| format!("Failed to parse parasha division {}", path.display()))
}

/// Insert the פרשה division row plus all 54 units, their Torah ranges,
/// and every ordered Haftarah auxiliary range.
pub fn insert_parasha_reading_units(tx: &Transaction, sefarim: &[Sefer]) -> Result<()> {
    let source = load_parasha_division()?;
    tx.execute(
        "INSERT INTO tanah_reading_division (id, contract_version, root_path, menu_label)
         VALUES (?1, ?2, ?3, ?4)",
        (
            PARASHA_DIVISION_ID,
            READING_CONTRACT_VERSION,
            &source.root_path,
            &source.menu_label,
        ),
    )?;

    // The parasha division is defined over the five Torah sefarim only.
    // A corpus that carries none of them (a fixture or a partial
    // export) still gets the division row — for a stable schema — but
    // no units. When any Torah sefer is present, resolution stays
    // strict: impossible references fail the export.
    if !source
        .units
        .iter()
        .any(|unit| sefarim.iter().any(|sefer| sefer.name == unit.sefer))
    {
        return Ok(());
    }

    let units = derive_parasha_units(&source, sefarim)?;
    insert_units(tx, PARASHA_DIVISION_ID, &units)
}

// --------------------------------------------------------------------
// Aliyah boundaries (#2519) — reading contexts, named schemes, and the
// per-(reading, scheme) boundary rows. The curated table is
// web/bible-on-site/src/data/parasha/parasha-aliyot.json, imported from
// hebcal-leyning by devops/import-parasha-aliyot.mjs — same shared-source
// shape as parasha-division.json so all consumers resolve identical data.
// --------------------------------------------------------------------

/// Source-table mirror of parasha-aliyot.json (fields the export needs).
#[derive(Debug, serde::Deserialize)]
pub struct ParashaAliyotSource {
    pub provenance: AliyahProvenanceSource,
    pub schemes: Vec<AliyahSchemeSource>,
    pub readings: Vec<AliyahReadingSource>,
}

#[derive(Debug, serde::Deserialize)]
pub struct AliyahProvenanceSource {
    pub name: String,
    pub repository: String,
    pub license: String,
    pub commit: String,
    pub retrieved: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct AliyahSchemeSource {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct AliyahReadingSource {
    pub id: String,
    /// Constituent parasha names in reading order (1 standalone, 2 joined).
    pub units: Vec<String>,
    pub sefer: String,
    /// Where the context applies (e.g. חוץ לארץ-only joins); absent = everywhere.
    pub applicability: Option<String>,
    pub schemes: HashMap<String, Vec<AliyahBoundarySource>>,
}

#[derive(Debug, serde::Deserialize)]
pub struct AliyahBoundarySource {
    pub ordinal: i32,
    pub role: String,
    pub label: String,
    pub start: SourceVerse,
    pub end: SourceVerse,
    pub note: Option<String>,
}

/// Path of the shared aliyah source table the website also consumes.
pub fn parasha_aliyot_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../web/bible-on-site/src/data/parasha/parasha-aliyot.json")
}

/// Load and parse the shared aliyah source table.
pub fn load_parasha_aliyot() -> Result<ParashaAliyotSource> {
    let path = parasha_aliyot_path();
    let json = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read parasha aliyot {}", path.display()))?;
    serde_json::from_str(&json)
        .with_context(|| format!("Failed to parse parasha aliyot {}", path.display()))
}

/// Insert aliyah schemes, reading contexts, their ordered constituent
/// units, and every resolved boundary row. Skips silently when the
/// corpus carries no parasha units (fixture/partial exports) — the same
/// degradation rule as insert_parasha_reading_units — but any present
/// Torah sefer resolves strictly.
pub fn insert_parasha_aliyot(tx: &Transaction, sefarim: &[Sefer]) -> Result<()> {
    let source = load_parasha_aliyot()?;
    if source.readings.is_empty() {
        return Ok(());
    }
    let division = load_parasha_division()?;
    if !division
        .units
        .iter()
        .any(|unit| sefarim.iter().any(|sefer| sefer.name == unit.sefer))
    {
        return Ok(());
    }

    tx.execute(
        "INSERT INTO tanah_parasha_aliyah_source
           (id, name, repository, license, upstream_commit, retrieved)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)",
        (
            &source.provenance.name,
            &source.provenance.repository,
            &source.provenance.license,
            &source.provenance.commit,
            &source.provenance.retrieved,
        ),
    )?;

    for (index, scheme) in source.schemes.iter().enumerate() {
        tx.execute(
            "INSERT INTO tanah_parasha_aliyah_scheme (id, label, description, scheme_order)
             VALUES (?1, ?2, ?3, ?4)",
            (
                &scheme.id,
                &scheme.label,
                &scheme.description,
                index as i32 + 1,
            ),
        )?;
    }

    // unit_id (positional, 1-based) by parasha name — the join key into
    // tanah_reading_unit rows just emitted.
    let unit_id_by_name: HashMap<&str, i32> = division
        .units
        .iter()
        .enumerate()
        .map(|(index, unit)| (unit.name.as_str(), index as i32 + 1))
        .collect();

    for reading in &source.readings {
        let sefer_id = sefarim
            .iter()
            .position(|s| s.name == reading.sefer)
            .ok_or_else(|| anyhow::anyhow!("aliyah data: unknown sefer \"{}\"", reading.sefer))?
            as i32
            + 1;
        let kind = if reading.units.len() > 1 {
            "joined"
        } else {
            "standalone"
        };
        tx.execute(
            "INSERT INTO tanah_parasha_reading (id, kind, sefer_id, applicability)
             VALUES (?1, ?2, ?3, ?4)",
            (&reading.id, kind, sefer_id, &reading.applicability),
        )?;
        for (position, name) in reading.units.iter().enumerate() {
            let unit_id = unit_id_by_name.get(name.as_str()).ok_or_else(|| {
                anyhow::anyhow!(
                    "aliyah data: {} references unknown parasha \"{name}\"",
                    reading.id
                )
            })?;
            tx.execute(
                "INSERT INTO tanah_parasha_reading_unit
                   (reading_id, unit_position, division_id, unit_id)
                 VALUES (?1, ?2, ?3, ?4)",
                (
                    &reading.id,
                    position as i32 + 1,
                    PARASHA_DIVISION_ID,
                    unit_id,
                ),
            )?;
        }
        for (scheme_id, boundaries) in &reading.schemes {
            for boundary in boundaries {
                let range = resolve_parasha_range(
                    sefarim,
                    &SourceRange {
                        sefer: reading.sefer.clone(),
                        additional: None,
                        start: SourceVerse {
                            perek: boundary.start.perek,
                            pasuk: boundary.start.pasuk,
                        },
                        end: SourceVerse {
                            perek: boundary.end.perek,
                            pasuk: boundary.end.pasuk,
                        },
                    },
                )
                .with_context(|| {
                    format!(
                        "aliyah data: {}/{} boundary {}",
                        reading.id, scheme_id, boundary.ordinal
                    )
                })?;
                tx.execute(
                    "INSERT INTO tanah_parasha_aliyah
                       (reading_id, scheme_id, ordinal, role, label,
                        start_perek_id, start_pasuk, end_perek_id, end_pasuk, note)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    (
                        &reading.id,
                        scheme_id,
                        boundary.ordinal,
                        &boundary.role,
                        &boundary.label,
                        range.start.perek_id,
                        range.start.pasuk,
                        range.end.perek_id,
                        range.end.pasuk,
                        &boundary.note,
                    ),
                )?;
            }
        }
    }
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
    fn derive_masora_units_skips_sefarim_without_perakim_parts() {
        // A sefer carrying neither `perakim` nor `additionals` has no
        // perakim parts at all — the derive loop skips it entirely.
        let mut sefarim = masora_sample_sefarim();
        sefarim.push(Sefer {
            id: "empty".to_string(),
            name: "ריק".to_string(),
            tanach_us_name: None,
            helek: "כתובים".to_string(),
            pesukim_count: 0,
            perek_from: 5,
            perek_to: 4,
            additionals: None,
            perakim: None,
        });
        let units = derive_masora_units(&sefarim).unwrap();
        assert_eq!(units.len(), 6);
        assert!(units.iter().all(|unit| unit.sefer_id != 3));
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
        assert_eq!(units[0].heading, "בראשית פרשה א");

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
        assert_eq!(units[1].heading, "בראשית פרשה ב");

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
        assert_eq!(units[2].heading, "בראשית פרשה ג");

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
        assert_eq!(units[3].heading, "בראשית פרשה ד");

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
        assert_eq!(units[4].heading, "שמואל פרשה א");

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
        assert_eq!(units[5].heading, "שמואל פרשה ב");
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
        assert_eq!(units[0].heading, "בראשית פרשה א");
        assert_eq!(units[49].heading, "בראשית פרשה נ");
        assert_eq!(units[3196].heading, "דברי הימים פרשה תכט");
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

    /// Load the checked-in tanah_view dump — the exact JSON the website
    /// resolves parasha references against.
    fn corpus_sefarim() -> Vec<Sefer> {
        let corpus_path = Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../../../web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
        );
        let json = fs::read_to_string(&corpus_path)
            .unwrap_or_else(|e| panic!("Failed to read corpus {}: {e}", corpus_path.display()));
        serde_json::from_str(&json).unwrap()
    }

    /// Export parity: resolve the shared parasha source table against
    /// the checked-in dump and assert the exact units, ranges, and
    /// auxiliary readings the website's parasha-units.ts produces.
    #[test]
    fn parasha_derivation_matches_website_export_parity() {
        let sefarim = corpus_sefarim();
        let source = load_parasha_division().unwrap();
        let units = derive_parasha_units(&source, &sefarim).unwrap();

        // 54 weekly parashiot — joined pairs stay separate identities.
        assert_eq!(units.len(), 54);
        for (i, unit) in units.iter().enumerate() {
            assert_eq!(unit.unit_id, i as i32 + 1);
            assert_eq!(unit.slug, (i as i32 + 1).to_string());
            assert_eq!(unit.closing_break, None);
            assert_eq!(unit.ranges.len(), 1);
        }

        // Only the five Torah sefarim carry primary parasha units, in
        // canonical order with per-sefer order resetting.
        let torah_sefer_ids: Vec<i32> = (1..=5).collect();
        assert!(units.iter().all(|u| torah_sefer_ids.contains(&u.sefer_id)));
        assert_eq!(units[0].sefer_id, 1);
        assert_eq!(units[0].order, 1);
        assert_eq!(units[11].order, 12); // ויחי — בראשית's 12th parasha
        assert_eq!(units[12].sefer_id, 2); // שמות — שמות's 1st
        assert_eq!(units[12].order, 1);
        assert_eq!(units[23].sefer_id, 3); // ויקרא
        assert_eq!(units[33].sefer_id, 4); // במדבר
        assert_eq!(units[43].sefer_id, 5); // דברים
        assert_eq!(units[53].sefer_id, 5);
        assert_eq!(units[53].order, 11); // וזאת הברכה — דברים's 11th

        // Headings are the parasha names — unit identities, not ref
        // spans — and joined pairs are never merged.
        assert_eq!(units[0].heading, "בראשית");
        assert_eq!(units[21].heading, "ויקהל");
        assert_eq!(units[22].heading, "פקודי");
        assert_eq!(units[41].heading, "מטות");
        assert_eq!(units[42].heading, "מסעי");

        // Unit 1: בראשית א א - ו ח → canonical perekIds 1..6.
        assert_eq!(
            units[0].ranges[0],
            ScriptureRange {
                start: Coordinate {
                    perek_id: 1,
                    pasuk: 1,
                    segment_index: None,
                },
                end: Coordinate {
                    perek_id: 6,
                    pasuk: 8,
                    segment_index: None,
                },
            }
        );

        // Unit 54 ends the Torah: דברים לד יב → last perekId of דברים.
        let devarim_last = sefarim[4].perek_to;
        assert_eq!(
            units[53].ranges[0].end,
            Coordinate {
                perek_id: devarim_last,
                pasuk: 12,
                segment_index: None,
            }
        );

        // Every primary range resolves inside its own Torah sefer.
        for unit in &units {
            let sefer = &sefarim[(unit.sefer_id - 1) as usize];
            let range = &unit.ranges[0];
            assert!(range.start.perek_id >= sefer.perek_from);
            assert!(range.end.perek_id <= sefer.perek_to);
        }

        // Auxiliary Haftarah readings: ordered, custom-keyed, never
        // flattened into a single reading.
        let aux_count: usize = units.iter().map(|u| u.auxiliary_readings.len()).sum();
        assert!(aux_count > 54); // most parashiot carry 2-3 custom variants

        // פרשת יתרו (unit 17): אשכנזים reads two ordered ranges with a
        // perek jump inside ישעיהו — order and non-contiguity preserved.
        let yitro = &units[16];
        assert_eq!(yitro.heading, "יתרו");
        let ashkenazi = yitro
            .auxiliary_readings
            .iter()
            .find(|a| a.id == "haftara-ashkenazi")
            .expect("יתרו ashkenazi haftara");
        assert_eq!(ashkenazi.label, "אשכנזים");
        assert_eq!(ashkenazi.ranges.len(), 2);
        assert!(ashkenazi.ranges[0].end.perek_id < ashkenazi.ranges[1].start.perek_id);

        // פרשת תזריע (unit 27): one reading shared by all three customs —
        // joined id, conjunctive label, and מלכים ב resolved through its
        // additional into מלכים's canonical perek space.
        let tazria = &units[26];
        assert_eq!(tazria.heading, "תזריע");
        let shared_tazria = tazria
            .auxiliary_readings
            .iter()
            .find(|a| a.id == "haftara-sefaradi-ashkenazi-temani")
            .expect("תזריע shared haftara");
        assert_eq!(shared_tazria.label, "ספרדים, אשכנזים ותימנים");
        assert_eq!(shared_tazria.ranges.len(), 1);
        let melachim = sefarim
            .iter()
            .find(|s| s.name == "מלכים")
            .expect("מלכים in corpus");
        let bet = melachim
            .additionals
            .as_ref()
            .expect("מלכים additionals")
            .iter()
            .find(|a| a.letter == "ב")
            .expect("מלכים ב");
        assert_eq!(
            shared_tazria.ranges[0].start.perek_id,
            bet.perek_from + 4 - 1
        );

        // מטות (unit 42): תימנים reads ירמיהו א א-יט — resolves in
        // ירמיהו's own perek space, beyond the אשכנזים end at ב ג.
        let matot = &units[41];
        let temani = matot
            .auxiliary_readings
            .iter()
            .find(|a| a.id == "haftara-temani")
            .expect("מטות temani haftara");
        assert_eq!(temani.ranges[0].end.pasuk, 19);

        // Shared-custom readings get a joined id and a conjunctive label.
        let vezot = &units[53];
        let shared = vezot
            .auxiliary_readings
            .iter()
            .find(|a| a.id == "haftara-sefaradi-temani")
            .expect("וזאת הברכה shared sefaradi+temani haftara");
        assert_eq!(shared.label, "ספרדים ותימנים");
    }

    /// Impossible references fail resolution, mirroring the website's
    /// module-load validation.
    #[test]
    fn parasha_derivation_rejects_impossible_references() {
        let sefarim = corpus_sefarim();
        let mut source = load_parasha_division().unwrap();

        // דברים has no perek 35.
        source.units[53].end.perek = 35;
        let err = derive_parasha_units(&source, &sefarim).unwrap_err();
        assert!(err.to_string().contains("exceeds"));

        let mut source = load_parasha_division().unwrap();
        // ירמיהו א has 19 pesukim; pasuk 20 is impossible.
        source.units[41].haftarot[1].ranges[0].end.pasuk = 20;
        let err = derive_parasha_units(&source, &sefarim).unwrap_err();
        assert!(err.to_string().contains("outside the canonical"));

        let mut source = load_parasha_division().unwrap();
        // מלכים is split into additionals — the letter is required.
        source.units[26].haftarot[0].ranges[0].additional = None;
        let err = derive_parasha_units(&source, &sefarim).unwrap_err();
        assert!(err.to_string().contains("split into additionals"));
    }

    /// Small corpus for parasha resolution edge cases: בראשית unsplit
    /// (perakim 1..=3, five pesukim each) and מלכים split into
    /// additionals א (perek 4) and ב (perek 5).
    fn parasha_fixture_sefarim() -> Vec<Sefer> {
        let five_pesukim = || (0..5).map(|_| text_pasuk()).collect::<Vec<_>>();
        vec![
            Sefer {
                id: "bereshit".to_string(),
                name: "בראשית".to_string(),
                tanach_us_name: None,
                helek: "תורה".to_string(),
                pesukim_count: 15,
                perek_from: 1,
                perek_to: 3,
                additionals: None,
                perakim: Some(vec![
                    perek(1, five_pesukim()),
                    perek(2, five_pesukim()),
                    perek(3, five_pesukim()),
                ]),
            },
            Sefer {
                id: "melachim".to_string(),
                name: "מלכים".to_string(),
                tanach_us_name: None,
                helek: "נביאים".to_string(),
                pesukim_count: 10,
                perek_from: 4,
                perek_to: 5,
                additionals: Some(vec![
                    Additional {
                        letter: "א".to_string(),
                        name: "מלכים א".to_string(),
                        tanach_us_name: None,
                        helek: "נביאים".to_string(),
                        order: 1,
                        pesukim_count: 5,
                        perek_from: 4,
                        perek_to: 4,
                        perakim: vec![perek(4, five_pesukim())],
                    },
                    Additional {
                        letter: "ב".to_string(),
                        name: "מלכים ב".to_string(),
                        tanach_us_name: None,
                        helek: "נביאים".to_string(),
                        order: 2,
                        pesukim_count: 5,
                        perek_from: 5,
                        perek_to: 5,
                        perakim: vec![perek(5, five_pesukim())],
                    },
                ]),
                perakim: None,
            },
        ]
    }

    fn source_verse(perek: i32, pasuk: i32) -> SourceVerse {
        SourceVerse { perek, pasuk }
    }

    fn source_range(
        sefer: &str,
        additional: Option<&str>,
        start: (i32, i32),
        end: (i32, i32),
    ) -> SourceRange {
        SourceRange {
            sefer: sefer.to_string(),
            additional: additional.map(str::to_string),
            start: source_verse(start.0, start.1),
            end: source_verse(end.0, end.1),
        }
    }

    fn parasha_fixture_source(units: Vec<ParashaSourceUnit>) -> ParashaDivisionSource {
        ParashaDivisionSource {
            root_path: "/פרשה".to_string(),
            menu_label: "פרשה על הפרק".to_string(),
            customs: HashMap::from([("ashkenazi".to_string(), "אשכנזים".to_string())]),
            units,
        }
    }

    fn parasha_fixture_unit(
        sefer: &str,
        start: (i32, i32),
        end: (i32, i32),
        haftarot: Vec<SourceHaftara>,
    ) -> ParashaSourceUnit {
        ParashaSourceUnit {
            name: "פלוני".to_string(),
            sefer: sefer.to_string(),
            start: source_verse(start.0, start.1),
            end: source_verse(end.0, end.1),
            haftarot,
        }
    }

    /// An "additional" letter on a sefer that is not split at all fails
    /// the sefer-part lookup.
    #[test]
    fn parasha_derivation_rejects_additional_on_unsplit_sefer() {
        let source = parasha_fixture_source(vec![parasha_fixture_unit(
            "בראשית",
            (1, 1),
            (1, 5),
            vec![SourceHaftara {
                customs: vec!["ashkenazi".to_string()],
                ranges: vec![source_range("בראשית", Some("א"), (1, 1), (1, 2))],
            }],
        )]);
        let err = derive_parasha_units(&source, &parasha_fixture_sefarim()).unwrap_err();
        assert!(err.to_string().contains("has no additional \"א\""), "{err}");
    }

    /// A letter outside the sefer's real additionals fails the same
    /// lookup after the parts list is found.
    #[test]
    fn parasha_derivation_rejects_unknown_additional_letter() {
        let source = parasha_fixture_source(vec![parasha_fixture_unit(
            "בראשית",
            (1, 1),
            (1, 5),
            vec![SourceHaftara {
                customs: vec!["ashkenazi".to_string()],
                ranges: vec![source_range("מלכים", Some("ז"), (1, 1), (1, 2))],
            }],
        )]);
        let err = derive_parasha_units(&source, &parasha_fixture_sefarim()).unwrap_err();
        assert!(err.to_string().contains("has no additional \"ז\""), "{err}");
    }

    /// A printed perek below the sefer's range resolves to a perekId
    /// that exists in no part, failing the pasuk-count lookup.
    #[test]
    fn parasha_derivation_rejects_perek_below_sefer_range() {
        let source =
            parasha_fixture_source(vec![parasha_fixture_unit("בראשית", (0, 1), (1, 5), vec![])]);
        let err = derive_parasha_units(&source, &parasha_fixture_sefarim()).unwrap_err();
        assert!(err.to_string().contains("unknown perekId"), "{err}");
    }

    /// Endpoints that move backwards — across perakim or within one
    /// perek — are impossible references, not reading order.
    #[test]
    fn parasha_derivation_rejects_backwards_ranges() {
        for (start, end) in [((3, 1), (1, 5)), ((2, 5), (2, 3))] {
            let source =
                parasha_fixture_source(vec![parasha_fixture_unit("בראשית", start, end, vec![])]);
            let err = derive_parasha_units(&source, &parasha_fixture_sefarim()).unwrap_err();
            assert!(err.to_string().contains("backwards range"), "{err}");
        }
    }

    /// A haftara with no customs gets the bare `haftara-` id and an
    /// empty label; a custom name missing from the labels table falls
    /// back to the raw key.
    #[test]
    fn parasha_derivation_labels_haftara_from_custom_keys() {
        let haftara = |customs: Vec<String>| SourceHaftara {
            customs,
            ranges: vec![source_range("מלכים", Some("ב"), (1, 1), (1, 2))],
        };
        let source = parasha_fixture_source(vec![parasha_fixture_unit(
            "בראשית",
            (1, 1),
            (1, 5),
            vec![haftara(vec![]), haftara(vec!["מנהג-אחר".to_string()])],
        )]);
        let units = derive_parasha_units(&source, &parasha_fixture_sefarim()).unwrap();
        let auxiliaries = &units[0].auxiliary_readings;
        assert_eq!(auxiliaries[0].id, "haftara-");
        assert_eq!(auxiliaries[0].label, "");
        assert_eq!(auxiliaries[1].id, "haftara-מנהג-אחר");
        assert_eq!(auxiliaries[1].label, "מנהג-אחר");
    }

    /// The reading-unit tables used by the insert-path tests; the range
    /// table's column list is parameterizable to exercise `?`
    /// propagation from schema mismatches.
    fn create_reading_unit_tables(conn: &Connection, range_table_sql: &str) {
        conn.execute_batch(&format!(
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
            {range_table_sql}"
        ))
        .unwrap();
    }

    /// When the range table cannot accept a primary range (here:
    /// auxiliary_ordinal must be non-NULL), the `?` on the primary
    /// insert propagates the failure out of the export.
    #[test]
    fn insert_parasha_reading_units_propagates_primary_range_failures() {
        let mut conn = Connection::open_in_memory().unwrap();
        create_reading_unit_tables(
            &conn,
            "CREATE TABLE tanah_reading_unit_range (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                division_id TEXT NOT NULL,
                unit_id INTEGER NOT NULL,
                range_index INTEGER NOT NULL,
                auxiliary_ordinal INTEGER CHECK (auxiliary_ordinal IS NOT NULL),
                auxiliary_id TEXT,
                auxiliary_label TEXT,
                start_perek_id INTEGER NOT NULL,
                start_pasuk INTEGER NOT NULL,
                start_segment_index INTEGER,
                end_perek_id INTEGER NOT NULL,
                end_pasuk INTEGER NOT NULL,
                end_segment_index INTEGER
            );",
        );

        let tx = conn.transaction().unwrap();
        let err = insert_parasha_reading_units(&tx, &corpus_sefarim()).unwrap_err();
        assert!(err.to_string().contains("auxiliary_ordinal"), "{err}");
    }

    /// When the range table accepts primary ranges but rejects
    /// auxiliary rows (here: auxiliary_id must stay NULL), the failure
    /// propagates through the auxiliary `?` after all primary inserts
    /// already succeeded.
    #[test]
    fn insert_parasha_reading_units_propagates_auxiliary_range_failures() {
        let mut conn = Connection::open_in_memory().unwrap();
        create_reading_unit_tables(
            &conn,
            "CREATE TABLE tanah_reading_unit_range (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                division_id TEXT NOT NULL,
                unit_id INTEGER NOT NULL,
                range_index INTEGER NOT NULL,
                auxiliary_ordinal INTEGER,
                auxiliary_id TEXT CHECK (auxiliary_id IS NULL),
                auxiliary_label TEXT,
                start_perek_id INTEGER NOT NULL,
                start_pasuk INTEGER NOT NULL,
                start_segment_index INTEGER,
                end_perek_id INTEGER NOT NULL,
                end_pasuk INTEGER NOT NULL,
                end_segment_index INTEGER
            );",
        );

        let tx = conn.transaction().unwrap();
        let err = insert_parasha_reading_units(&tx, &corpus_sefarim()).unwrap_err();
        assert!(err.to_string().contains("auxiliary_id"), "{err}");
    }

    /// The insert path writes the division row, all units, primary
    /// ranges, and auxiliary rows keyed by haftara id.
    #[test]
    fn insert_parasha_reading_units_writes_units_ranges_and_auxiliaries() {
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
        insert_parasha_reading_units(&tx, &corpus_sefarim()).unwrap();
        tx.commit().unwrap();

        let division: (String, i64, String, String) = conn
            .query_row(
                "SELECT id, contract_version, root_path, menu_label
                 FROM tanah_reading_division WHERE id = 'parasha'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            division,
            (
                PARASHA_DIVISION_ID.to_string(),
                READING_CONTRACT_VERSION,
                "/פרשה".to_string(),
                "פרשה על הפרק".to_string(),
            )
        );

        let unit_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_reading_unit", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(unit_count, 54);

        let primary_range_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_reading_unit_range WHERE auxiliary_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(primary_range_count, 54);

        let aux_range_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_reading_unit_range WHERE auxiliary_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(aux_range_count > 54);

        // Auxiliary ordinals preserve the source order within a unit.
        let ordered_aux: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT DISTINCT auxiliary_id FROM tanah_reading_unit_range
                     WHERE unit_id = 1 AND auxiliary_id IS NOT NULL
                     ORDER BY auxiliary_ordinal",
                )
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            ordered_aux,
            vec![
                "haftara-sefaradi".to_string(),
                "haftara-ashkenazi".to_string(),
                "haftara-temani".to_string(),
            ]
        );
    }

    /// The aliyah export writes schemes, standalone and joined reading
    /// contexts, ordered constituent units, and resolved boundary rows —
    /// parity-checked against the checked-in corpus + curated table.
    #[test]
    fn insert_parasha_aliyot_writes_schemes_readings_and_boundaries() {
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
            );
            CREATE TABLE tanah_parasha_aliyah_scheme (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                description TEXT NOT NULL,
                scheme_order INTEGER NOT NULL
            );
            CREATE TABLE tanah_parasha_reading (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                sefer_id INTEGER NOT NULL,
                applicability TEXT
            );
            CREATE TABLE tanah_parasha_reading_unit (
                reading_id TEXT NOT NULL,
                unit_position INTEGER NOT NULL,
                division_id TEXT NOT NULL,
                unit_id INTEGER NOT NULL,
                PRIMARY KEY (reading_id, unit_position)
            );
            CREATE TABLE tanah_parasha_aliyah (
                reading_id TEXT NOT NULL,
                scheme_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                role TEXT NOT NULL,
                label TEXT NOT NULL,
                start_perek_id INTEGER NOT NULL,
                start_pasuk INTEGER NOT NULL,
                end_perek_id INTEGER NOT NULL,
                end_pasuk INTEGER NOT NULL,
                note TEXT,
                PRIMARY KEY (reading_id, scheme_id, ordinal)
            );
            CREATE TABLE tanah_parasha_aliyah_source (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                repository TEXT NOT NULL,
                license TEXT NOT NULL,
                upstream_commit TEXT NOT NULL,
                retrieved TEXT NOT NULL
            );",
        )
        .unwrap();

        let sefarim = corpus_sefarim();
        let tx = conn.transaction().unwrap();
        insert_parasha_reading_units(&tx, &sefarim).unwrap();
        insert_parasha_aliyot(&tx, &sefarim).unwrap();
        tx.commit().unwrap();

        let scheme_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_parasha_aliyah_scheme",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(scheme_count, 2);

        let (standalone, joined): (i64, i64) = conn
            .query_row(
                "SELECT
                   COALESCE(SUM(kind = 'standalone'), 0),
                   COALESCE(SUM(kind = 'joined'), 0)
                 FROM tanah_parasha_reading",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((standalone, joined), (54, 7));

        // Constituent links: 54 solo + 7 pairs, in reading order.
        let constituent_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_parasha_reading_unit",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(constituent_count, 54 + 14);
        let joined_units: Vec<i64> = {
            let mut stmt = conn
                .prepare(
                    "SELECT unit_id FROM tanah_parasha_reading_unit
                     WHERE reading_id = 'Nitzavim-Vayeilech' ORDER BY unit_position",
                )
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(joined_units.len(), 2);
        assert!(joined_units[0] < joined_units[1]);

        // Shabbat boundaries: 53 parashiot × (7+maftir), וזאת הברכה
        // carries no maftir, plus 7 joins × 8. Weekday: 54 × 3.
        let (shabbat, weekday): (i64, i64) = conn
            .query_row(
                "SELECT
                   COALESCE(SUM(scheme_id = 'shabbat'), 0),
                   COALESCE(SUM(scheme_id = 'weekday'), 0)
                 FROM tanah_parasha_aliyah",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((shabbat, weekday), (53 * 8 + 7 + 7 * 8, 54 * 3));

        // Bereshit aliyah 1 resolves to canonical perekIds 1→2.
        let bereshit: (i64, i64, i64, i64) = conn
            .query_row(
                "SELECT start_perek_id, start_pasuk, end_perek_id, end_pasuk
                 FROM tanah_parasha_aliyah
                 WHERE reading_id = 'Bereshit' AND scheme_id = 'shabbat' AND ordinal = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(bereshit, (1, 1, 2, 3));

        // A joined aliyah may cross a perek (Nitzavim-Vayeilech #4
        // spans Devarim 30:15-31:6) — end perekId stays strictly ahead.
        let crossing: (i64, i64, i64, i64) = conn
            .query_row(
                "SELECT start_perek_id, start_pasuk, end_perek_id, end_pasuk
                 FROM tanah_parasha_aliyah
                 WHERE reading_id = 'Nitzavim-Vayeilech' AND scheme_id = 'shabbat' AND ordinal = 4",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(
            crossing.0 < crossing.2,
            "aliyah 4 crosses a perek: {crossing:?}"
        );
        assert_eq!((crossing.1, crossing.3), (15, 6));

        // Maftir is a distinct role; וזאת הברכה legitimately lacks one.
        let maftir_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_parasha_aliyah WHERE role = 'maftir'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(maftir_count, 53 + 7);
        let vezot_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_parasha_aliyah WHERE reading_id = 'Vezot Haberakhah'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(vezot_rows, 7 + 3); // 7 shabbat + 3 weekday, no maftir

        // Documented variant notes survive the export verbatim.
        let noted: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_parasha_aliyah WHERE note IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(noted, 4); // Bereshit ×2, Terumah ×2

        // חוקת-בלק is the only restricted-applicability context.
        let restricted: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tanah_parasha_reading
                 WHERE applicability IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restricted, 1);
        let chukat_applicability: String = conn
            .query_row(
                "SELECT applicability FROM tanah_parasha_reading
                 WHERE id = 'Chukat-Balak'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(chukat_applicability, "חוץ לארץ בלבד");

        // Provenance lands verbatim as the single source row.
        let provenance: (String, String) = conn
            .query_row(
                "SELECT name, upstream_commit FROM tanah_parasha_aliyah_source WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(provenance.0.contains("hebcal"));
        assert_eq!(provenance.1, "ec5c7642e3");
    }

    /// Corpus without Torah sefarim degrades to a no-op (the parasha
    /// units path already guards partial exports the same way).
    #[test]
    fn insert_parasha_aliyot_noops_without_torah_sefarim() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tanah_parasha_aliyah_scheme (id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL, scheme_order INTEGER NOT NULL);
             CREATE TABLE tanah_parasha_reading (id TEXT PRIMARY KEY, kind TEXT NOT NULL, sefer_id INTEGER NOT NULL, applicability TEXT);",
        )
        .unwrap();
        // An empty corpus carries no parasha-unit-bearing sefer, so the
        // guard fires before any resolution is attempted.
        let tx = conn.transaction().unwrap();
        insert_parasha_aliyot(&tx, &[]).unwrap();
        tx.commit().unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM tanah_parasha_reading", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(rows, 0);
    }
}
