//! Manually reviewed paragraph-to-pasuk anchors for the Torat Emet edition.
//!
//! Simanim and parashot are literary divisions, never biblical coordinates.
//! The edition and its exact text/segmentation are checked before any output.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Context, Result, bail, ensure};
use bson::{Bson, Document};
use serde::Deserialize;

use super::{
    extract::Note,
    manual_map::{Anchor, fingerprint, resolve_ref},
};

type Mapping = BTreeMap<String, Vec<Vec<Option<Anchor>>>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version_title: String,
    parashot: BTreeMap<String, SourceSection>,
    parashah_order: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSection {
    hash: String,
    #[serde(default)]
    reviewed_hashes: Vec<String>,
    paragraph_counts: Vec<usize>,
    paragraph_hashes: Vec<Vec<Vec<String>>>,
}

fn mapping() -> Result<Mapping> {
    let mut mapping: Mapping = serde_json::from_str(include_str!("tanchuma_genesis_exodus.json"))?;
    let rest: Mapping = serde_json::from_str(include_str!("tanchuma_leviticus_deuteronomy.json"))?;
    for (key, value) in rest {
        ensure!(
            mapping.insert(key.clone(), value).is_none(),
            "Duplicate parashah: {key}"
        );
    }
    Ok(mapping)
}

/// Generate notes only after verifying the edition and every mapped section.
pub fn flatten(doc: &Document, perush_id: i64) -> Result<Vec<Note>> {
    let manifest: Manifest = serde_json::from_str(include_str!("tanchuma_manifest.json"))?;
    let selected_title = doc
        .get_array("versionTitles")?
        .first()
        .and_then(Bson::as_str);
    ensure!(
        selected_title == Some(manifest.version_title.as_str()),
        "Midrash Tanchuma requires the manually mapped edition: {}",
        manifest.version_title
    );
    let version = doc
        .get_array("versions")?
        .first()
        .and_then(Bson::as_document)
        .context("Midrash Tanchuma requires a parashah-keyed version document")?;
    let mapping = mapping()?;
    ensure!(
        mapping.len() == manifest.parashot.len(),
        "Tanchuma dictionary/manifest key mismatch"
    );

    // An added literary node must be reviewed rather than silently discarded.
    for (key, value) in version {
        if !mapping.contains_key(key) {
            ensure!(
                matches!(key.as_str(), "Foreword" | "Introduction") && is_empty(value),
                "Unmapped Tanchuma node: {key}"
            );
        }
    }

    let verse_counts: BTreeMap<String, Vec<usize>> =
        serde_json::from_str(include_str!("verse_counts.json"))?;
    let mut notes = Vec::new();
    let mut indices = HashMap::new();
    ensure!(
        manifest.parashah_order.len() == mapping.len(),
        "Incomplete Tanchuma reading order"
    );
    let mut visited = HashSet::new();
    for key in &manifest.parashah_order {
        ensure!(
            visited.insert(key),
            "Duplicate Tanchuma reading-order entry: {key}"
        );
        let simanim = mapping
            .get(key)
            .context("Unknown Tanchuma reading-order entry")?;
        let source = version
            .get(key)
            .with_context(|| format!("Missing Tanchuma parashah: {key}"))?;
        let expected = manifest
            .parashot
            .get(key)
            .context("Missing Tanchuma manifest entry")?;
        validate_source(key, source, expected)?;
        flatten_parashah(
            &mut notes,
            &mut indices,
            perush_id,
            key,
            source,
            simanim,
            &verse_counts,
        )?;
    }
    Ok(notes)
}

fn is_empty(value: &Bson) -> bool {
    match value {
        Bson::String(text) => text.trim().is_empty(),
        Bson::Array(items) => items.iter().all(is_empty),
        _ => false,
    }
}

fn validate_source(key: &str, source: &Bson, expected: &SourceSection) -> Result<()> {
    let mut hash = 0xcbf29ce484222325;
    fingerprint(source, &mut hash)?;
    let actual_hash = format!("{hash:016x}");
    let known_snapshot =
        actual_hash == expected.hash || expected.reviewed_hashes.contains(&actual_hash);
    let simanim = source
        .as_array()
        .context("Tanchuma parashah must contain simanim")?;
    ensure!(
        simanim.len() == expected.paragraph_counts.len()
            && simanim.len() == expected.paragraph_hashes.len(),
        "Tanchuma {key}: siman count changed"
    );
    for (index, siman) in simanim.iter().enumerate() {
        let paragraphs = match siman {
            Bson::String(_) => std::slice::from_ref(siman),
            Bson::Array(paragraphs) => paragraphs.as_slice(),
            _ => bail!("Tanchuma {key} {}: unsupported siman shape", index + 1),
        };
        ensure!(
            paragraphs.len() == expected.paragraph_counts[index]
                && paragraphs.len() == expected.paragraph_hashes[index].len(),
            "Tanchuma {key} {}: paragraph count changed",
            index + 1
        );
        if !known_snapshot {
            // A cached dump can contain an intermediate combination of the
            // independently reviewed transcription corrections. Accept only
            // exact reviewed paragraph texts, keeping the same segmentation.
            for (paragraph_idx, paragraph) in paragraphs.iter().enumerate() {
                let mut hash = 0xcbf29ce484222325;
                fingerprint(paragraph, &mut hash)?;
                ensure!(
                    expected.paragraph_hashes[index][paragraph_idx]
                        .contains(&format!("{hash:016x}")),
                    "Tanchuma {key} {}:{}: source text changed; manually review the dictionary before regenerating",
                    index + 1,
                    paragraph_idx + 1
                );
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn flatten_parashah(
    notes: &mut Vec<Note>,
    indices: &mut HashMap<(i64, i64), i64>,
    perush_id: i64,
    key: &str,
    source: &Bson,
    mapping: &[Vec<Option<Anchor>>],
    verse_counts: &BTreeMap<String, Vec<usize>>,
) -> Result<()> {
    let simanim = source.as_array().context("Expected simanim array")?;
    ensure!(
        simanim.len() == mapping.len(),
        "Tanchuma {key}: dictionary siman count mismatch"
    );
    for (siman_idx, (siman, anchors)) in simanim.iter().zip(mapping).enumerate() {
        let paragraphs = match siman {
            Bson::String(_) => std::slice::from_ref(siman),
            Bson::Array(items) => items,
            _ => bail!("Unsupported Tanchuma siman"),
        };
        ensure!(
            paragraphs.len() == anchors.len(),
            "Tanchuma {key} {}: dictionary paragraph count mismatch",
            siman_idx + 1
        );
        for (paragraph_idx, (paragraph, anchor)) in paragraphs.iter().zip(anchors).enumerate() {
            let text = paragraph
                .as_str()
                .context("Expected Tanchuma paragraph string")?
                .trim();
            let Some(anchor) = anchor else {
                continue;
            };
            ensure!(!anchor.refs().is_empty(), "Empty Tanchuma anchor list");
            let mut seen = HashSet::new();
            for reference in anchor.refs() {
                let (perek_id, pasuk) =
                    resolve_ref(reference, verse_counts).with_context(|| {
                        format!("Tanchuma {key} {}:{}", siman_idx + 1, paragraph_idx + 1)
                    })?;
                ensure!(
                    seen.insert((perek_id, pasuk)),
                    "Duplicate Tanchuma anchor: {reference}"
                );
                if text.is_empty() {
                    continue;
                }
                let note_idx = indices.entry((perek_id, pasuk)).or_insert(0);
                notes.push(Note {
                    perush_id,
                    perek_id,
                    pasuk,
                    note_idx: *note_idx,
                    note_content: text.to_string(),
                });
                *note_idx += 1;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{bson, doc};

    #[test]
    fn every_source_paragraph_has_an_explicit_reviewed_mapping_slot() {
        let mapping = mapping().unwrap();
        let manifest: Manifest =
            serde_json::from_str(include_str!("tanchuma_manifest.json")).unwrap();
        let counts = serde_json::from_str(include_str!("verse_counts.json")).unwrap();
        assert_eq!(mapping.len(), 54);
        assert_eq!(mapping.len(), manifest.parashot.len());
        let mut slots = 0;
        let mut unmapped = Vec::new();
        for (key, simanim) in &mapping {
            let expected = &manifest.parashot[key].paragraph_counts;
            assert_eq!(simanim.len(), expected.len(), "{key}");
            for (siman_idx, (siman, count)) in simanim.iter().zip(expected).enumerate() {
                assert_eq!(siman.len(), *count, "{key}");
                slots += count;
                for (paragraph_idx, anchor) in siman.iter().enumerate() {
                    if anchor.is_none() {
                        unmapped.push(format!("{key} {}:{}", siman_idx + 1, paragraph_idx + 1));
                    }
                }
                for anchor in siman.iter().flatten() {
                    assert!(!anchor.refs().is_empty());
                    let mut seen = HashSet::new();
                    for reference in anchor.refs() {
                        let resolved = resolve_ref(reference, &counts).unwrap();
                        assert!(seen.insert(resolved), "{key}: {reference}");
                        assert!((1..=187).contains(&resolved.0), "Use the Torah context");
                    }
                }
            }
        }
        assert_eq!(slots, 2121);
        assert_eq!(
            unmapped,
            [
                "Bereshit 13:1",
                "Bereshit 13:2",
                "Bereshit 13:3",
                "Bereshit 13:4",
                "Bereshit 13:5",
                "Masei 5:1",
                "Masei 13:2",
                "Toldot 14:1",
                "Toldot 14:2",
                "Toldot 14:3",
                "V'Zot HaBerachah 7:2",
            ]
        );
    }

    #[test]
    fn paragraph_targets_can_cross_chapters_and_share_a_pasuk_without_losing_notes() {
        let source = bson!([["first", "second"], "indivisible", "colophon"]);
        let anchors: Vec<Vec<Option<Anchor>>> = serde_json::from_str(
            r#"[["Genesis 4:15", "Genesis 5:29"], [["Genesis 4:15", "Genesis 5:29"]], [null]]"#,
        )
        .unwrap();
        let counts = serde_json::from_str(include_str!("verse_counts.json")).unwrap();
        let mut notes = Vec::new();
        flatten_parashah(
            &mut notes,
            &mut HashMap::new(),
            42,
            "sample",
            &source,
            &anchors,
            &counts,
        )
        .unwrap();
        assert_eq!(notes.len(), 4);
        assert_eq!(
            (notes[0].perek_id, notes[0].pasuk, notes[0].note_idx),
            (4, 15, 0)
        );
        assert_eq!((notes[1].perek_id, notes[1].pasuk), (5, 29));
        assert_eq!(notes[2].note_idx, 1);
        assert_eq!(notes[3].note_idx, 1);
        assert_eq!(notes[2].note_content, "indivisible");
    }

    #[test]
    fn refuses_an_unmapped_edition_and_changed_source() {
        assert!(
            flatten(
                &doc! {"versionTitles": ["Tsel Midrash Tanchuma"], "versions": [{}]},
                1
            )
            .is_err()
        );
        let source = bson!([["changed"]]);
        let expected = SourceSection {
            hash: "wrong".into(),
            reviewed_hashes: Vec::new(),
            paragraph_counts: vec![1],
            paragraph_hashes: vec![vec![vec!["unreviewed".into()]]],
        };
        assert!(validate_source("Bereshit", &source, &expected).is_err());
    }

    #[test]
    fn accepts_only_individually_reviewed_transcription_variants_in_cached_snapshots() {
        fn hash(value: &Bson) -> String {
            let mut hash = 0xcbf29ce484222325;
            fingerprint(value, &mut hash).unwrap();
            format!("{hash:016x}")
        }
        let historical = bson!([["old first", "old second"]]);
        let current = bson!([["new first", "new second"]]);
        let expected = SourceSection {
            hash: hash(&historical),
            reviewed_hashes: vec![hash(&current)],
            paragraph_counts: vec![2],
            paragraph_hashes: vec![vec![
                vec![hash(&bson!("old first")), hash(&bson!("new first"))],
                vec![hash(&bson!("old second")), hash(&bson!("new second"))],
            ]],
        };
        // Each paragraph is known, although this combination is neither of
        // the two complete snapshots used during the manual source review.
        assert!(
            validate_source("sample", &bson!([["old first", "new second"]]), &expected).is_ok()
        );
        assert!(validate_source("sample", &bson!([["old first", "unknown"]]), &expected).is_err());
        assert!(
            validate_source("sample", &bson!([["old first"], ["new second"]]), &expected).is_err()
        );
    }

    #[test]
    fn checks_actual_verse_bounds_and_split_books() {
        let counts = serde_json::from_str(include_str!("verse_counts.json")).unwrap();
        assert_eq!(resolve_ref("I Kings 8:66", &counts).unwrap(), (295, 66));
        assert_eq!(resolve_ref("Psalms 33:7", &counts).unwrap(), (600, 7));
        for reference in [
            "Genesis 0:1",
            "Genesis 51:1",
            "Genesis 1:32",
            "Exodus 1:0",
            "Invented 1:1",
        ] {
            assert!(resolve_ref(reference, &counts).is_err(), "{reference}");
        }
    }
}
