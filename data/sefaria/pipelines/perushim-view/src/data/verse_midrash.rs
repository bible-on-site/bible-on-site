//! Midrashim whose verified Sefaria schemas already address biblical chapters/verses.
//! Literary simanim are deliberately unsupported. Both schema metadata and each
//! nonempty coordinate are checked before notes can reach an output writer.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Context, Result, bail, ensure};
use bson::{Bson, Document};

use super::{extract::Note, perek_mapping};

const TITLES: &[&str] = &[
    "Midrash Lekach Tov",
    "Midrash Mishlei",
    "Midrash Tannaim on Deuteronomy",
    "Mekhilta DeRabbi Shimon Ben Yochai",
];

pub fn titles() -> &'static [&'static str] {
    TITLES
}

pub fn supports(title: &str) -> bool {
    TITLES.contains(&title)
}

/// Use only the explicitly verified schemas, retaining all paragraphs at a verse.
pub fn flatten(doc: &Document, perush_id: i64) -> Result<Vec<Note>> {
    let title = doc.get_str("enTitle")?;
    ensure!(
        supports(title),
        "Unsupported verse-aligned midrash: {title}"
    );
    let schema = doc.get_document("schema")?;
    let version = doc
        .get_array("versions")?
        .first()
        .context("Missing Hebrew midrash version")?;
    let counts: BTreeMap<String, Vec<usize>> =
        serde_json::from_str(include_str!("verse_counts.json"))?;
    let mut output = Output {
        perush_id,
        counts,
        notes: Vec::new(),
        indices: HashMap::new(),
    };

    if title == "Midrash Mishlei" {
        validate_schema(schema, &["Perek", "Integer"], None)?;
        output.chapters("Proverbs", version, 2)?;
        return Ok(output.notes);
    }

    // Sefaria removed Tannaim's default-node wrapper after the 2024 dump.
    // Both known layouts retain the same biblical chapter/verse coordinates;
    // verify the complete simple schema before accepting its chapter array.
    if title == "Midrash Tannaim on Deuteronomy" && !schema.contains_key("nodes") {
        validate_schema(
            schema,
            &["Integer", "Integer", "Integer"],
            Some("Paragraph"),
        )?;
        output.chapters("Deuteronomy", version, 3)?;
        return Ok(output.notes);
    }

    // These names/order come from the pinned June 2024 Sefaria index schemas.
    let (keys, addresses, paragraph): (&[&str], &[&str], Option<&str>) = match title {
        "Midrash Lekach Tov" => (
            &["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"],
            &["Integer", "Integer", "Integer"],
            Some("Midrash"),
        ),
        "Midrash Tannaim on Deuteronomy" => (
            &["default"],
            &["Integer", "Integer", "Integer"],
            Some("Paragraph"),
        ),
        "Mekhilta DeRabbi Shimon Ben Yochai" => {
            (&["default", "Additions"], &["Perek", "Integer"], None)
        }
        _ => unreachable!("supported title checked above"),
    };
    let version = version
        .as_document()
        .context("Expected midrash node document")?;
    let nodes = schema.get_array("nodes")?;
    let mut visited = HashSet::new();
    for &key in keys {
        let node = nodes
            .iter()
            .filter_map(Bson::as_document)
            .find(|node| node.get_str("key").ok() == Some(key))
            .with_context(|| format!("{title}: missing expected schema node {key}"))?;
        validate_schema(node, addresses, paragraph).with_context(|| format!("{title}, {key}"))?;
        let mut text = version.get(key);
        visited.insert(key);
        // Sefaria's JSON export calls the default node ""; MongoDB uses
        // "default". Accept either explicitly, never duplicate their contents.
        if key == "default" {
            visited.insert("");
            if let Some(alias) = version.get("") {
                ensure!(
                    text.is_none_or(is_empty) || is_empty(alias),
                    "{title}: two nonempty default nodes"
                );
                if text.is_none_or(is_empty) {
                    text = Some(alias);
                }
            }
        }
        let book = match title {
            "Midrash Tannaim on Deuteronomy" => "Deuteronomy",
            "Mekhilta DeRabbi Shimon Ben Yochai" => "Exodus",
            _ => key,
        };
        if let Some(text) = text {
            output.chapters(book, text, addresses.len())?;
        }
    }
    for (key, text) in version {
        ensure!(
            visited.contains(key.as_str()) || is_empty(text),
            "{title}: nonempty unrecognized node {key}"
        );
    }
    Ok(output.notes)
}

fn validate_schema(node: &Document, addresses: &[&str], paragraph: Option<&str>) -> Result<()> {
    let depth = node
        .get("depth")
        .and_then(|value| value.as_i64().or_else(|| value.as_i32().map(i64::from)));
    ensure!(
        depth == Some(addresses.len() as i64),
        "Unexpected midrash depth"
    );
    let mut sections = vec!["Chapter", "Verse"];
    if let Some(paragraph) = paragraph {
        sections.push(paragraph);
    }
    for (field, expected) in [
        ("sectionNames", sections.as_slice()),
        ("addressTypes", addresses),
    ] {
        let actual = node.get_array(field)?;
        ensure!(
            actual.len() == expected.len()
                && actual
                    .iter()
                    .zip(expected)
                    .all(|(value, expected)| value.as_str() == Some(*expected)),
            "Midrash {field} is not the verified biblical coordinate schema"
        );
    }
    Ok(())
}

fn is_empty(value: &Bson) -> bool {
    match value {
        Bson::Null | Bson::Boolean(false) => true,
        Bson::String(text) => text.trim().is_empty(),
        Bson::Array(items) => items.iter().all(is_empty),
        Bson::Document(fields) => fields.values().all(is_empty),
        _ => false,
    }
}

struct Output {
    perush_id: i64,
    counts: BTreeMap<String, Vec<usize>>,
    notes: Vec<Note>,
    indices: HashMap<(i64, i64), i64>,
}

impl Output {
    fn chapters(&mut self, book: &str, text: &Bson, depth: usize) -> Result<()> {
        if is_empty(text) {
            return Ok(());
        }
        let (sefer, additional) = perek_mapping::english_node_key_to_sefer(book)
            .context("Unrecognized midrash biblical book")?;
        let counts = self
            .counts
            .get(book)
            .context("Missing biblical verse counts")?;
        let chapters = text.as_array().context("Expected midrash chapters array")?;
        for (chapter_idx, chapter) in chapters.iter().enumerate() {
            if is_empty(chapter) {
                continue;
            }
            ensure!(
                chapter_idx < counts.len(),
                "{book}: out-of-range biblical chapter {}",
                chapter_idx + 1
            );
            let verses = chapter
                .as_array()
                .context("Expected midrash verses array")?;
            for (verse_idx, verse) in verses.iter().enumerate() {
                if is_empty(verse) {
                    continue;
                }
                ensure!(
                    verse_idx < counts[chapter_idx],
                    "{book} {}: out-of-range biblical verse {}",
                    chapter_idx + 1,
                    verse_idx + 1
                );
                let paragraphs = match depth {
                    2 => std::slice::from_ref(verse),
                    3 => verse
                        .as_array()
                        .context("Expected midrash paragraph array")?,
                    _ => bail!("Unsupported midrash text depth"),
                };
                for paragraph in paragraphs {
                    if is_empty(paragraph) {
                        continue;
                    }
                    let text = paragraph
                        .as_str()
                        .context("Expected midrash paragraph string")?
                        .trim();
                    let perek_id =
                        perek_mapping::first_perek_id(sefer, additional) + chapter_idx as i64;
                    let pasuk = verse_idx as i64 + 1;
                    let index = self.indices.entry((perek_id, pasuk)).or_insert(0);
                    self.notes.push(Note {
                        perush_id: self.perush_id,
                        perek_id,
                        pasuk,
                        note_idx: *index,
                        note_content: text.to_owned(),
                    });
                    *index += 1;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{bson, doc};

    fn node(key: &str, addresses: &[&str], paragraph: Option<&str>) -> Document {
        let mut sections = vec!["Chapter", "Verse"];
        sections.extend(paragraph);
        doc! {"key": key, "depth": addresses.len() as i64,
        "sectionNames": sections, "addressTypes": addresses.to_vec()}
    }

    fn shimon(default: Bson, additions: Bson) -> Document {
        doc! {
            "enTitle": "Mekhilta DeRabbi Shimon Ben Yochai",
            "schema": {"nodes": [node("default", &["Perek", "Integer"], None),
                node("Additions", &["Perek", "Integer"], None)]},
            "versions": [{"default": default, "Additions": additions}]
        }
    }

    #[test]
    fn default_and_additions_append_without_losing_same_verse() {
        let notes = flatten(&shimon(bson!([["main"]]), bson!([["addition"]])), 17).unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(
            (notes[0].perek_id, notes[0].pasuk, notes[0].note_idx),
            (51, 1, 0)
        );
        assert_eq!(
            (notes[1].perek_id, notes[1].pasuk, notes[1].note_idx),
            (51, 1, 1)
        );
        assert_eq!(notes[1].note_content, "addition");
    }

    #[test]
    fn validates_metadata_unknown_content_and_actual_verse_bounds() {
        let mut source = shimon(bson!([["main"]]), bson!([]));
        source
            .get_document_mut("schema")
            .unwrap()
            .get_array_mut("nodes")
            .unwrap()[0]
            .as_document_mut()
            .unwrap()
            .insert("sectionNames", bson!(["Siman", "Paragraph"]));
        assert!(flatten(&source, 1).is_err());
        let mut source = shimon(bson!([["main"]]), bson!([]));
        source.get_array_mut("versions").unwrap()[0]
            .as_document_mut()
            .unwrap()
            .insert("new", "unmapped");
        assert!(flatten(&source, 1).is_err());
        let invalid = Bson::Array(
            vec![bson!([]); 40]
                .into_iter()
                .chain([bson!(["chapter 41"])])
                .collect(),
        );
        assert!(flatten(&shimon(invalid, bson!([])), 1).is_err());
        let invalid = Bson::Array(vec![Bson::String("text".into()); 23]);
        assert!(flatten(&shimon(Bson::Array(vec![invalid]), bson!([])), 1).is_err());
    }

    #[test]
    fn retains_each_paragraph_and_accepts_known_export_empty_sentinels() {
        let source = doc! {
            "enTitle": "Midrash Tannaim on Deuteronomy",
            "schema": {"nodes": [node("default", &["Integer", "Integer", "Integer"], Some("Paragraph"))]},
            "versions": [{"": [[["first", false, "second"]]], "Introduction": []}]
        };
        let notes = flatten(&source, 9).unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(
            (notes[1].perek_id, notes[1].pasuk, notes[1].note_idx),
            (154, 1, 1)
        );
        assert_eq!(notes[1].note_content, "second");
    }

    #[test]
    fn tannaim_simple_and_default_schemas_preserve_identical_biblical_coordinates() {
        let title = "Midrash Tannaim on Deuteronomy";
        let chapters = bson!([[["first", "second"], ["third"]], [["next chapter"]]]);
        let mut simple = doc! {
            "enTitle": title,
            "schema": node(title, &["Integer", "Integer", "Integer"], Some("Paragraph")),
            "versions": [chapters.clone()]
        };
        let complex = doc! {
            "enTitle": title,
            "schema": {"nodes": [node("default", &["Integer", "Integer", "Integer"], Some("Paragraph"))]},
            "versions": [{"default": chapters.clone()}]
        };
        let coordinates = |notes: Vec<Note>| {
            notes
                .into_iter()
                .map(|note| (note.perek_id, note.pasuk, note.note_idx, note.note_content))
                .collect::<Vec<_>>()
        };
        let actual = coordinates(flatten(&simple, 9).unwrap());
        assert_eq!(actual, coordinates(flatten(&complex, 9).unwrap()));
        assert_eq!(
            actual,
            vec![
                (154, 1, 0, "first".into()),
                (154, 1, 1, "second".into()),
                (154, 2, 0, "third".into()),
                (155, 1, 0, "next chapter".into()),
            ]
        );
        simple
            .get_document_mut("schema")
            .unwrap()
            .insert("sectionNames", bson!(["Chapter", "Siman", "Paragraph"]));
        assert!(flatten(&simple, 9).is_err());
        simple.insert(
            "schema",
            node(title, &["Integer", "Integer", "Integer"], Some("Paragraph")),
        );
        simple.insert("versions", bson!([{"default": chapters}]));
        assert!(
            flatten(&simple, 9).is_err(),
            "simple schemas require a chapter array"
        );
    }

    #[test]
    fn mishlei_uses_proverbs_coordinates_and_never_infers_simanim() {
        let source = doc! {
            "enTitle": "Midrash Mishlei", "schema": node("Midrash Mishlei", &["Perek", "Integer"], None),
            "versions": [[["a", "b"]]]
        };
        let notes = flatten(&source, 5).unwrap();
        assert_eq!((notes[1].perek_id, notes[1].pasuk), (718, 2));
        assert!(!supports("Sifra"));
        assert!(!supports("Midrash Tanchuma"));
        assert!(!supports("Midrash Aggadah"));
        assert!(!supports("Midrash Sekhel Tov"));
    }

    #[test]
    fn multi_book_verse_schema_uses_each_biblical_book_and_keeps_paragraphs() {
        let nodes: Vec<_> = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]
            .iter()
            .map(|key| node(key, &["Integer", "Integer", "Integer"], Some("Midrash")))
            .collect();
        let source = doc! {
            "enTitle": "Midrash Lekach Tov", "schema": {"nodes": nodes},
            "versions": [{"Genesis": [[["first", false, "second"]]], "Exodus": [[["third"]]]}]
        };
        let notes = flatten(&source, 23).unwrap();
        assert_eq!(notes.len(), 3);
        assert_eq!((notes[0].perek_id, notes[0].note_idx), (1, 0));
        assert_eq!((notes[1].perek_id, notes[1].note_idx), (1, 1));
        assert_eq!(
            (notes[2].perek_id, notes[2].pasuk, notes[2].note_idx),
            (51, 1, 0)
        );
    }

    /// Uses the dump's index/text collections, including the competing one-note
    /// Mishlei edition. Checks both reviewed Tannaim generations: the 2024
    /// default-node edition and the current simple schema. The test never
    /// retrieves source texts over the network.
    #[cfg(feature = "integration")]
    #[tokio::test]
    async fn mongo_pipeline_preserves_supported_verse_aligned_midrashim() {
        let host = std::env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".into());
        let port = std::env::var("MONGO_PORT").unwrap_or_else(|_| "27017".into());
        let database =
            std::env::var("DUMP_NAME").unwrap_or_else(|_| "sefaria-dump-5784-sivan-4".into());
        let client = mongodb::Client::with_uri_str(format!("mongodb://{host}:{port}"))
            .await
            .unwrap();
        let collection = client.database(&database).collection::<Document>("index");
        let mut pipeline = crate::aggregation::build_pipeline();
        pipeline.push(doc! {"$match": {"enTitle": {"$in": titles().to_vec()}}});
        let mut cursor = collection.aggregate(pipeline).await.unwrap();
        let mut found = HashSet::new();
        while cursor.advance().await.unwrap() {
            let doc = cursor.deserialize_current().unwrap();
            let title = doc.get_str("enTitle").unwrap();
            assert!(found.insert(title.to_string()), "duplicate source title");
            let (expected_notes, expected_verses, version, first_coordinate, chapter_range) =
                match title {
                    "Midrash Lekach Tov" => (
                        7822,
                        4231,
                        "Midrash Lekach Tov on Torah, Vilna 1884",
                        (1, 1),
                        1..=187,
                    ),
                    "Midrash Mishlei" => (140, 140, "מדרש משלי - שלמה באבער", (718, 1), 718..=748),
                    "Midrash Tannaim on Deuteronomy"
                        if !doc.get_document("schema").unwrap().contains_key("nodes") =>
                    {
                        (3978, 498, "Berlin, 1908", (154, 1), 154..=187)
                    }
                    "Midrash Tannaim on Deuteronomy" => {
                        (3979, 497, "Berlin, 1908", (154, 1), 154..=187)
                    }
                    "Mekhilta DeRabbi Shimon Ben Yochai" => (
                        382,
                        379,
                        "Mechilta de-Rabbi Simon b. Jochai, Dr. D. Hoffman, Frankfurt 1905",
                        (53, 1),
                        51..=90,
                    ),
                    _ => unreachable!(),
                };
            assert_eq!(
                doc.get_array("versionTitles").unwrap()[0].as_str(),
                Some(version),
                "{title}"
            );
            let notes = flatten(&doc, 7).unwrap();
            assert_eq!(notes.len(), expected_notes, "{title}");
            let coordinates: HashSet<_> = notes.iter().map(|n| (n.perek_id, n.pasuk)).collect();
            assert_eq!(coordinates.len(), expected_verses, "{title}");
            assert!(coordinates.contains(&first_coordinate), "{title}");
            assert!(
                notes.iter().all(|n| chapter_range.contains(&n.perek_id)),
                "{title}"
            );
            let keys: HashSet<_> = notes
                .iter()
                .map(|n| (n.perek_id, n.pasuk, n.note_idx))
                .collect();
            assert_eq!(
                keys.len(),
                notes.len(),
                "{title}: note primary-key collision"
            );
        }
        assert_eq!(
            found.len(),
            titles().len(),
            "missing supported midrash index"
        );
    }
}
