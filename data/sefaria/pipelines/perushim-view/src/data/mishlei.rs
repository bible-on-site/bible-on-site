//! Buber's Midrash Mishlei uses packed homily numbers, despite its Verse label.
//! Preserve each complete source unit and apply its manually reviewed subjects.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Context, Result, ensure};
use bson::{Bson, Document};
use serde::Deserialize;

use super::{
    extract::Note,
    manual_map::{Anchor, fingerprint, resolve_ref},
};

type Mapping = Vec<Vec<Option<Anchor>>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version_title: String,
    unit_hashes: Vec<Vec<Vec<String>>>,
}

pub fn flatten(doc: &Document, perush_id: i64) -> Result<Vec<Note>> {
    let manifest: Manifest = serde_json::from_str(include_str!("mishlei_manifest.json"))?;
    let mapping: Mapping = serde_json::from_str(include_str!("mishlei_mapping.json"))?;
    ensure!(
        doc.get_str("enTitle")? == "Midrash Mishlei",
        "Unsupported Mishlei title"
    );
    ensure!(
        doc.get_array("versionTitles")?
            .first()
            .and_then(Bson::as_str)
            == Some(manifest.version_title.as_str()),
        "Midrash Mishlei requires the reviewed Buber edition"
    );
    let schema = doc.get_document("schema")?;
    let depth = schema
        .get("depth")
        .and_then(|n| n.as_i64().or_else(|| n.as_i32().map(i64::from)));
    ensure!(depth == Some(2), "Midrash Mishlei source structure changed");
    for (key, expected) in [
        ("sectionNames", ["Chapter", "Verse"]),
        ("addressTypes", ["Perek", "Integer"]),
    ] {
        let actual = schema.get_array(key)?;
        ensure!(
            actual.len() == expected.len()
                && actual
                    .iter()
                    .zip(expected)
                    .all(|(a, b)| a.as_str() == Some(b)),
            "Midrash Mishlei {key} changed; review source segmentation"
        );
    }
    let chapters = doc
        .get_array("versions")?
        .first()
        .and_then(Bson::as_array)
        .context("Midrash Mishlei requires chapter/homily arrays")?;
    flatten_units(chapters, &mapping, &manifest, perush_id)
}

fn flatten_units(
    chapters: &[Bson],
    mapping: &Mapping,
    manifest: &Manifest,
    perush_id: i64,
) -> Result<Vec<Note>> {
    ensure!(
        chapters.len() == mapping.len() && chapters.len() == manifest.unit_hashes.len(),
        "Midrash Mishlei chapter count changed"
    );
    let counts: BTreeMap<String, Vec<usize>> =
        serde_json::from_str(include_str!("verse_counts.json"))?;
    let mut notes = Vec::new();
    let mut indices = HashMap::new();
    for (chapter_idx, chapter) in chapters.iter().enumerate() {
        let units = chapter
            .as_array()
            .context("Mishlei source chapter is not an array")?;
        let anchors = &mapping[chapter_idx];
        let hashes = &manifest.unit_hashes[chapter_idx];
        ensure!(
            units.len() == anchors.len() && units.len() == hashes.len(),
            "Midrash Mishlei {}: homily segmentation changed",
            chapter_idx + 1
        );
        for (unit_idx, unit) in units.iter().enumerate() {
            let text = unit.as_str().context("Mishlei source homily is not text")?;
            let mut hash = 0xcbf29ce484222325;
            fingerprint(unit, &mut hash)?;
            ensure!(
                hashes[unit_idx].contains(&format!("{hash:016x}")),
                "Midrash Mishlei {}:{}: source text changed; manually review its dictionary",
                chapter_idx + 1,
                unit_idx + 1
            );
            let Some(anchor) = &anchors[unit_idx] else {
                continue;
            };
            ensure!(!anchor.refs().is_empty(), "Empty Mishlei anchor list");
            let mut seen = HashSet::new();
            for reference in anchor.refs() {
                let (perek_id, pasuk) = resolve_ref(reference, &counts)
                    .with_context(|| format!("Mishlei {}:{}", chapter_idx + 1, unit_idx + 1))?;
                ensure!(
                    seen.insert((perek_id, pasuk)),
                    "Duplicate Mishlei subject {reference}"
                );
                if text.trim().is_empty() {
                    continue;
                }
                let index = indices.entry((perek_id, pasuk)).or_insert(0);
                notes.push(Note {
                    perush_id,
                    perek_id,
                    pasuk,
                    note_idx: *index,
                    note_content: text.trim().to_owned(),
                });
                *index += 1;
            }
        }
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{bson, doc};

    #[test]
    fn every_source_unit_has_a_reviewed_slot_with_only_two_explicit_placeholders() {
        let mapping: Mapping = serde_json::from_str(include_str!("mishlei_mapping.json")).unwrap();
        let manifest: Manifest =
            serde_json::from_str(include_str!("mishlei_manifest.json")).unwrap();
        let counts = serde_json::from_str(include_str!("verse_counts.json")).unwrap();
        assert_eq!(mapping.len(), 31);
        assert_eq!(manifest.unit_hashes.len(), 31);
        let mut placeholders = Vec::new();
        let mut slots = 0;
        for (c, units) in mapping.iter().enumerate() {
            assert_eq!(units.len(), manifest.unit_hashes[c].len());
            for (u, anchor) in units.iter().enumerate() {
                slots += 1;
                match anchor {
                    None => placeholders.push((c + 1, u + 1)),
                    Some(anchor) => {
                        assert_eq!(anchor.refs().len(), 1, "Use the passage's first verse");
                        assert!(anchor.refs()[0].starts_with(&format!("Proverbs {}:", c + 1)));
                        let mut seen = HashSet::new();
                        for reference in anchor.refs() {
                            assert!(seen.insert(resolve_ref(reference, &counts).unwrap()));
                        }
                    }
                }
            }
        }
        assert_eq!(slots, 140);
        assert_eq!(placeholders, [(3, 1), (18, 1)]);
        assert!(
            mapping[10][1]
                .as_ref()
                .unwrap()
                .refs()
                .iter()
                .any(|r| r == "Proverbs 11:21")
        );
        assert!(
            mapping[30][1]
                .as_ref()
                .unwrap()
                .refs()
                .iter()
                .any(|r| r == "Proverbs 31:10")
        );
    }

    #[test]
    fn packed_homilies_use_reviewed_verses_and_append_notes_without_collisions() {
        let units = bson!([["one", "two"]]).as_array().unwrap().clone();
        let mapping =
            serde_json::from_str(r#"[["Proverbs 11:21",["Proverbs 11:21","Proverbs 31:10"]]]"#)
                .unwrap();
        let hashes = units[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|unit| {
                let mut h = 0xcbf29ce484222325;
                fingerprint(unit, &mut h).unwrap();
                vec![format!("{h:016x}")]
            })
            .collect();
        let manifest = Manifest {
            version_title: "test".into(),
            unit_hashes: vec![hashes],
        };
        let notes = flatten_units(&units, &mapping, &manifest, 4).unwrap();
        assert_eq!(notes.len(), 3);
        assert_eq!(
            (notes[0].perek_id, notes[0].pasuk, notes[0].note_idx),
            (728, 21, 0)
        );
        assert_eq!(
            (notes[1].perek_id, notes[1].pasuk, notes[1].note_idx),
            (728, 21, 1)
        );
        assert_eq!((notes[2].perek_id, notes[2].pasuk), (748, 10));
        assert!(flatten_units(&[bson!(["changed", "two"])], &mapping, &manifest, 4).is_err());
    }

    #[test]
    fn an_unmapped_edition_is_rejected() {
        assert!(
            flatten(
                &doc! {"enTitle":"Midrash Mishlei","versionTitles":["bar ilan responsa project"]},
                1
            )
            .is_err()
        );
    }
}
