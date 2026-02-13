//! Extract parshan, perush, and note entities from pipeline output documents.
//!
//! The pipeline outputs one document per (perush_name, sefer) combination.
//! This module deduplicates parshanim and perushim, and flattens the nested
//! version arrays into individual note rows.

use std::collections::HashMap;

use bson::Document;

use super::perek_mapping;

/// A commentator (author).
#[derive(Debug, Clone)]
pub struct Parshan {
    pub id: i64,
    pub name: String,
    /// Birth year when known (e.g. from Sefaria person.birthDate).
    pub birth_year: Option<i64>,
    /// Whether a portrait image is available (legacy: has_pic).
    pub has_pic: bool,
}

/// A commentary work.
#[derive(Debug, Clone)]
pub struct Perush {
    pub id: i64,
    pub name: String,
    pub parshan_id: i64,
    pub comp_date: Option<String>,
    pub pub_date: Option<String>,
    /// Display order in carousel (lower = first). Legacy: priority.
    pub priority: i64,
}

/// A single commentary note for a specific pasuk.
#[derive(Debug, Clone)]
pub struct Note {
    pub perush_id: i64,
    pub perek_id: i64,
    pub pasuk: i64,
    pub note_idx: i64,
    pub note_content: String,
}

/// Extracted and deduplicated entities.
pub struct Extracted {
    pub parshanim: Vec<Parshan>,
    pub perushim: Vec<Perush>,
    pub notes: Vec<Note>,
}

/// Extract all three entities from the pipeline output documents.
pub fn extract(docs: &[Document]) -> Extracted {
    let mut parshan_map: HashMap<String, i64> = HashMap::new(); // name → id
    let mut parshanim: Vec<Parshan> = Vec::new();
    let mut perush_map: HashMap<String, i64> = HashMap::new(); // name → id
    let mut perushim: Vec<Perush> = Vec::new();
    let mut notes: Vec<Note> = Vec::new();

    for doc in docs {
        let perush_name = doc.get_str("name").unwrap_or("").to_string();
        if perush_name.is_empty() {
            continue;
        }

        let authors = extract_authors(doc);
        let first_author = authors
            .first()
            .cloned()
            .unwrap_or_else(|| "לא ידוע".to_string());

        // Deduplicate parshan
        let parshan_id = if let Some(&id) = parshan_map.get(&first_author) {
            id
        } else {
            let id = (parshanim.len() + 1) as i64;
            let birth_year = parse_birth_year(doc.get("firstAuthorBirthYear"));
            parshanim.push(Parshan {
                id,
                name: first_author.clone(),
                birth_year,
                has_pic: false, // Not in Sefaria; can be set by static data later
            });
            parshan_map.insert(first_author, id);
            id
        };

        // Deduplicate perush
        let perush_id = if let Some(&id) = perush_map.get(&perush_name) {
            id
        } else {
            let id = (perushim.len() + 1) as i64;
            let priority = derive_priority(&perush_name, doc.get("compDate"));
            perushim.push(Perush {
                id,
                name: perush_name.clone(),
                parshan_id,
                comp_date: bson_to_optional_string(doc.get("compDate")),
                pub_date: bson_to_optional_string(doc.get("pubDate")),
                priority,
            });
            perush_map.insert(perush_name, id);
            id
        };

        // Flatten versions into notes
        let sefer = bson_to_i64(doc.get("sefer"));
        let additional = doc.get("additional").and_then(bson_to_optional_i64);
        let base_perek_id = perek_mapping::first_perek_id(sefer, additional);

        if base_perek_id == 0 {
            continue; // Unknown sefer mapping
        }

        if let Some(bson::Bson::Array(versions)) = doc.get("versions") {
            // Use the first version (usually only one after filtering)
            match versions.first() {
                // Simple schema: versions[0] is a flat array of chapters
                Some(bson::Bson::Array(chapters)) => {
                    flatten_chapters(&mut notes, perush_id, base_perek_id, chapters);
                }
                // Complex schema (e.g. Ramban, Ibn Ezra on Torah): versions[0]
                // is a Document with node keys like {"intro": [...], "default": [[...]]}
                // The actual verse-by-verse commentary lives in the "default" node
                // (or whichever node the schema marks as default).
                Some(bson::Bson::Document(version_doc)) => {
                    let default_key = find_default_node_key(doc);
                    if let Some(bson::Bson::Array(chapters)) = version_doc.get(&default_key) {
                        flatten_chapters(&mut notes, perush_id, base_perek_id, chapters);
                    }
                }
                _ => {}
            }
        }
    }

    Extracted {
        parshanim,
        perushim,
        notes,
    }
}

/// Find the node key that contains the verse-by-verse commentary data
/// in a complex-schema document.
///
/// Complex schemas have `schema.nodes` — an array of node descriptors.
/// The commentary data lives in the node with `key: "default"` (Sefaria
/// convention for the main content node). If no "default" is found,
/// falls back to the first node with depth >= 3 (chapter/verse/comment
/// structure), or just "default" as a last resort.
fn find_default_node_key(doc: &Document) -> String {
    if let Some(bson::Bson::Document(schema)) = doc.get("schema")
        && let Some(bson::Bson::Array(nodes)) = schema.get("nodes")
    {
        // First pass: look for a node with key == "default"
        for node in nodes {
            if let bson::Bson::Document(node_doc) = node
                && let Some(bson::Bson::String(key)) = node_doc.get("key")
                && key == "default"
            {
                return key.clone();
            }
        }
        // Second pass: look for a node with depth >= 3
        // (chapter/verse/comment structure)
        for node in nodes {
            if let bson::Bson::Document(node_doc) = node {
                let depth = match node_doc.get("depth") {
                    Some(bson::Bson::Int32(n)) => *n as i64,
                    Some(bson::Bson::Int64(n)) => *n,
                    _ => 0,
                };
                if depth >= 3
                    && let Some(bson::Bson::String(key)) = node_doc.get("key")
                {
                    return key.clone();
                }
            }
        }
    }
    "default".to_string()
}

/// Flatten chapter/verse/note arrays into Note rows.
fn flatten_chapters(
    notes: &mut Vec<Note>,
    perush_id: i64,
    base_perek_id: i64,
    chapters: &[bson::Bson],
) {
    for (ch_idx, chapter) in chapters.iter().enumerate() {
        let perek_id = base_perek_id + ch_idx as i64;

        if let bson::Bson::Array(verses) = chapter {
            for (v_idx, verse) in verses.iter().enumerate() {
                let pasuk = (v_idx + 1) as i64;
                flatten_verse_entry(notes, perush_id, perek_id, pasuk, verse);
            }
        }
    }
}

/// Flatten a single verse entry which may be a string, array, or nested structure.
fn flatten_verse_entry(
    notes: &mut Vec<Note>,
    perush_id: i64,
    perek_id: i64,
    pasuk: i64,
    verse: &bson::Bson,
) {
    match verse {
        // Single string note for this pasuk
        bson::Bson::String(text) => {
            let text = text.trim();
            if !text.is_empty() {
                notes.push(Note {
                    perush_id,
                    perek_id,
                    pasuk,
                    note_idx: 0,
                    note_content: text.to_string(),
                });
            }
        }
        // Array — could be multiple notes or deeper nesting
        bson::Bson::Array(items) => {
            let mut note_idx = 0i64;
            for item in items {
                match item {
                    bson::Bson::String(text) => {
                        let text = text.trim();
                        if !text.is_empty() {
                            notes.push(Note {
                                perush_id,
                                perek_id,
                                pasuk,
                                note_idx,
                                note_content: text.to_string(),
                            });
                            note_idx += 1;
                        }
                    }
                    // Deeper nesting (depth > 3): flatten recursively
                    bson::Bson::Array(sub_items) => {
                        for sub_item in sub_items {
                            if let bson::Bson::String(text) = sub_item {
                                let text = text.trim();
                                if !text.is_empty() {
                                    notes.push(Note {
                                        perush_id,
                                        perek_id,
                                        pasuk,
                                        note_idx,
                                        note_content: text.to_string(),
                                    });
                                    note_idx += 1;
                                }
                            }
                        }
                    }
                    _ => {} // Skip null etc.
                }
            }
        }
        _ => {} // Skip null etc.
    }
}

/// Extract author names from a BSON document's `authors` field.
fn extract_authors(doc: &Document) -> Vec<String> {
    match doc.get("authors") {
        Some(bson::Bson::Array(arr)) => arr
            .iter()
            .filter_map(|v| {
                if let bson::Bson::String(s) = v {
                    Some(s.clone())
                } else {
                    None
                }
            })
            .collect(),
        _ => vec![],
    }
}

fn bson_to_i64(value: Option<&bson::Bson>) -> i64 {
    match value {
        Some(bson::Bson::Int32(n)) => *n as i64,
        Some(bson::Bson::Int64(n)) => *n,
        Some(bson::Bson::Double(n)) => *n as i64,
        _ => 0,
    }
}

fn bson_to_optional_i64(value: &bson::Bson) -> Option<i64> {
    match value {
        bson::Bson::Int32(n) => Some(*n as i64),
        bson::Bson::Int64(n) => Some(*n),
        bson::Bson::Double(n) => Some(*n as i64),
        _ => None,
    }
}

fn bson_to_optional_string(value: Option<&bson::Bson>) -> Option<String> {
    match value {
        Some(bson::Bson::String(s)) => Some(s.clone()),
        Some(bson::Bson::Int32(n)) => Some(n.to_string()),
        Some(bson::Bson::Int64(n)) => Some(n.to_string()),
        Some(bson::Bson::Double(n)) => Some(n.to_string()),
        Some(bson::Bson::Null) | None => None,
        Some(other) => Some(format!("{}", other)),
    }
}

/// Parse Sefaria birthDate (e.g. "1040", "1040-1105") to a single year.
fn parse_birth_year(value: Option<&bson::Bson>) -> Option<i64> {
    let s = match value {
        Some(bson::Bson::String(s)) => s.as_str(),
        Some(bson::Bson::Int32(n)) => return Some(*n as i64),
        Some(bson::Bson::Int64(n)) => return Some(*n),
        _ => return None,
    };
    // Take first 4 consecutive digits (handles "1040", "1040-1105", "c. 1040").
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).take(4).collect();
    if digits.len() == 4 {
        digits.parse().ok()
    } else {
        None
    }
}

/// Derive display priority with special ordering rules:
/// - Targum variants (תרגום): priority 0-99 (first, ordered chronologically among themselves)
/// - Rashi (רש"י): priority 100 (second)
/// - All others: chronological by composition date starting from 200
///
/// This matches the legacy app ordering where Targum always appears first,
/// then Rashi, then other commentaries by chronological order.
fn derive_priority(perush_name: &str, comp_date: Option<&bson::Bson>) -> i64 {
    // Special handling for Targum (all variants first)
    if perush_name.contains("תרגום") {
        // All Targumim must be < 100 to appear before Rashi
        // Map their chronological order (0-600 CE) to 0-99 range
        let year = extract_year_from_comp_date(comp_date);
        return if year < 9999 {
            // Scale ancient years (0-600) to 0-99
            // 0 → 0, 80 → 13, 150 → 25, 380 → 63, 600 → 99
            ((year as f64 / 600.0) * 99.0).round() as i64
        } else {
            50 // Default for Targum without date (middle of range)
        };
    }

    // Special handling for Rashi (second after all Targumim)
    if perush_name == "רש\"י" {
        return 100;
    }

    // All others: chronological, starting from 200
    let year = extract_year_from_comp_date(comp_date);
    if year < 9999 {
        200 + year
    } else {
        9999 // Unknown dates last
    }
}

/// Extract the first year from a composition date field.
/// Handles formats like "[1155, 1165]", "1040", "[0, 600]", etc.
fn extract_year_from_comp_date(value: Option<&bson::Bson>) -> i64 {
    let s = bson_to_optional_string(value).unwrap_or_default();

    // Handle array format like "[80, 120]" or "[1155, 1165]"
    // Extract first complete number (not just first 4 digits)
    let mut current_number = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            current_number.push(ch);
        } else if !current_number.is_empty() {
            // Hit non-digit after collecting digits - we have first number
            break;
        }
    }

    if !current_number.is_empty() {
        current_number.parse().unwrap_or(9999)
    } else {
        9999
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{bson, doc};

    /// Helper: build a simple-schema pipeline output document.
    /// `chapters` is a Bson::Array of chapters (each chapter = array of verses).
    fn simple_schema_doc(name: &str, sefer: i64, chapters: bson::Bson) -> Document {
        doc! {
            "name": name,
            "authors": [name],
            "sefer": sefer,
            "versions": [chapters],
            "schema": {
                "depth": 3,
                "addressTypes": ["Perek", "Pasuk", "Integer"],
                "sectionNames": ["Chapter", "Verse", "Comment"]
            }
        }
    }

    /// Helper: build a complex-schema pipeline output document.
    /// `node_key` is the key inside versions[0] that holds the chapters (e.g. "default").
    fn complex_schema_doc(
        name: &str,
        sefer: i64,
        node_key: &str,
        chapters: bson::Bson,
    ) -> Document {
        let mut version_doc = doc! {
            "intro": [["intro text"]],
        };
        version_doc.insert(node_key.to_string(), chapters);

        doc! {
            "name": name,
            "authors": [name],
            "sefer": sefer,
            "versions": [version_doc],
            "schema": {
                "nodes": [
                    { "key": "intro", "depth": 1 },
                    { "key": node_key, "depth": 3, "addressTypes": ["Perek", "Pasuk", "Integer"] }
                ]
            }
        }
    }

    #[test]
    fn simple_schema_extraction() {
        // Two chapters: ch1 has 2 verses (strings), ch2 has 1 verse
        let chapters = bson!([["note ch1 v1", "note ch1 v2"], ["note ch2 v1"]]);
        let doc = simple_schema_doc("רש\"י", 1, chapters);
        let result = extract(&[doc]);

        assert_eq!(result.parshanim.len(), 1);
        assert_eq!(result.perushim.len(), 1);
        assert_eq!(result.notes.len(), 3);

        // sefer 1 (Bereshit) → base_perek_id = 1
        assert_eq!(result.notes[0].perek_id, 1);
        assert_eq!(result.notes[0].pasuk, 1);
        assert_eq!(result.notes[0].note_content, "note ch1 v1");

        assert_eq!(result.notes[1].perek_id, 1);
        assert_eq!(result.notes[1].pasuk, 2);
        assert_eq!(result.notes[1].note_content, "note ch1 v2");

        assert_eq!(result.notes[2].perek_id, 2);
        assert_eq!(result.notes[2].pasuk, 1);
        assert_eq!(result.notes[2].note_content, "note ch2 v1");
    }

    #[test]
    fn complex_schema_default_key() {
        // Ramban-like: versions[0] is a Document with "default" holding chapters
        let chapters = bson!([["ramban ch1 v1", "ramban ch1 v2"], ["ramban ch2 v1"]]);
        let doc = complex_schema_doc("רמב\"ן", 1, "default", chapters);
        let result = extract(&[doc]);

        assert_eq!(result.parshanim.len(), 1);
        assert_eq!(result.perushim.len(), 1);
        assert_eq!(
            result.notes.len(),
            3,
            "complex schema notes should be extracted"
        );

        assert_eq!(result.notes[0].perek_id, 1);
        assert_eq!(result.notes[0].pasuk, 1);
        assert_eq!(result.notes[0].note_content, "ramban ch1 v1");

        assert_eq!(result.notes[1].perek_id, 1);
        assert_eq!(result.notes[1].pasuk, 2);
        assert_eq!(result.notes[1].note_content, "ramban ch1 v2");

        assert_eq!(result.notes[2].perek_id, 2);
        assert_eq!(result.notes[2].pasuk, 1);
        assert_eq!(result.notes[2].note_content, "ramban ch2 v1");
    }

    #[test]
    fn complex_schema_fallback_to_depth() {
        // Non-"default" key but depth >= 3 → should still find it
        let chapters = bson!([["custom ch1 v1"]]);
        let doc = complex_schema_doc("test perush", 1, "commentary", chapters);
        let result = extract(&[doc]);

        assert_eq!(
            result.notes.len(),
            1,
            "should find node by depth >= 3 fallback"
        );
        assert_eq!(result.notes[0].note_content, "custom ch1 v1");
    }

    #[test]
    fn empty_versions_produces_no_notes() {
        let doc = doc! {
            "name": "empty perush",
            "authors": ["test"],
            "sefer": 1,
            "versions": [],
            "schema": { "depth": 3 }
        };
        let result = extract(&[doc]);

        assert_eq!(result.parshanim.len(), 1);
        assert_eq!(result.perushim.len(), 1);
        assert_eq!(result.notes.len(), 0);
    }

    #[test]
    fn perush_deduplication_across_sefarim() {
        // Same perush name on two different sefarim → one parshan, one perush, different perek_ids
        let ch1 = bson!([["note sefer1"]]);
        let ch2 = bson!([["note sefer2"]]);
        let doc1 = simple_schema_doc("רש\"י", 1, ch1);
        let doc2 = simple_schema_doc("רש\"י", 2, ch2);
        let result = extract(&[doc1, doc2]);

        assert_eq!(result.parshanim.len(), 1);
        assert_eq!(result.perushim.len(), 1);
        assert_eq!(result.notes.len(), 2);

        // sefer 1 → perek_id 1, sefer 2 (Shemot) → perek_id 51
        assert_eq!(result.notes[0].perek_id, 1);
        assert_eq!(result.notes[1].perek_id, 51);
    }

    #[test]
    fn nested_array_notes_flattened() {
        // Verse with multiple notes (array of strings)
        let chapters = bson!([[["note1", "note2", "note3"]]]);
        let doc = simple_schema_doc("test", 1, chapters);
        let result = extract(&[doc]);

        assert_eq!(result.notes.len(), 3);
        assert_eq!(result.notes[0].note_idx, 0);
        assert_eq!(result.notes[0].note_content, "note1");
        assert_eq!(result.notes[1].note_idx, 1);
        assert_eq!(result.notes[2].note_idx, 2);
    }

    #[test]
    fn mixed_simple_and_complex_perushim() {
        // One simple + one complex in the same batch
        let simple_chapters = bson!([["simple note"]]);
        let complex_chapters = bson!([["complex note"]]);

        let doc1 = simple_schema_doc("רש\"י", 1, simple_chapters);
        let doc2 = complex_schema_doc("רמב\"ן", 1, "default", complex_chapters);

        let result = extract(&[doc1, doc2]);

        assert_eq!(result.parshanim.len(), 2);
        assert_eq!(result.perushim.len(), 2);
        assert_eq!(result.notes.len(), 2);

        assert_eq!(result.notes[0].note_content, "simple note");
        assert_eq!(result.notes[1].note_content, "complex note");
    }

    #[test]
    fn unknown_sefer_skipped() {
        let chapters = bson!([["note"]]);
        let doc = simple_schema_doc("test", 99, chapters); // sefer 99 doesn't exist
        let result = extract(&[doc]);

        assert_eq!(result.parshanim.len(), 1);
        assert_eq!(result.perushim.len(), 1);
        assert_eq!(
            result.notes.len(),
            0,
            "unknown sefer should produce no notes"
        );
    }

    #[test]
    fn empty_and_whitespace_notes_skipped() {
        let chapters = bson!([["", "  ", "real note", "  "]]);
        let doc = simple_schema_doc("test", 1, chapters);
        let result = extract(&[doc]);

        assert_eq!(result.notes.len(), 1);
        assert_eq!(result.notes[0].note_content, "real note");
        assert_eq!(result.notes[0].pasuk, 3); // 1-indexed: the 3rd verse has content
    }
}
