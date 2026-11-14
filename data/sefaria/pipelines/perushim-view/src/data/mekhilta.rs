//! Explicit Exodus mappings for Sefaria's two Mekhilta d'Rabbi Yishmael schemas.
//!
//! The 5784 Sivan dump already uses biblical chapter/verse/paragraph arrays:
//! <https://github.com/Sefaria/Sefaria-Export-Archive/blob/a155a11352fea18612328587e6897105a7f6b357/schemas/Mekhilta_d%27Rabbi_Yishmael.json>.
//! The renamed, newer work uses tractates. Its `alt_structs.Chapter` maps
//! individual Exodus verses to precise tractate paragraph ranges. In that
//! format `startingAddress` and `skipped_addresses` are significant; indexing
//! `refs` consecutively would silently attach many notes to the wrong verse.
//!
//! Neither cross-chapter `wholeRef` ranges nor ordinary quotation links are
//! used. Every nonempty source paragraph must be covered, or extraction fails.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use anyhow::{Context, Result, bail, ensure};
use bson::{Bson, Document};

use super::{extract::Note, perek_mapping};

const OLD_TITLE: &str = "Mekhilta d'Rabbi Yishmael";
const TITLE: &str = "Mekhilta DeRabbi Yishmael";

// Masoretic verse counts, including the Hebrew numbering of Exodus 20–22.
const VERSE_COUNTS: [usize; 40] = [
    22, 25, 22, 31, 23, 30, 29, 28, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 23, 37, 30, 33, 18,
    40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38,
];

type Source = (usize, usize, usize); // schema node index, section, paragraph; 1-based addresses
type Target = (usize, usize); // Exodus chapter, verse

/// Flatten either the pinned biblical schema or the newer tractate schema.
///
/// The input is the aggregation output, with `enTitle`, `schema`,
/// `alt_structs`, and the first selected Hebrew version retained.
pub fn flatten(doc: &Document, perush_id: i64) -> Result<Vec<Note>> {
    let title = doc
        .get_str("enTitle")
        .context("Mekhilta: missing enTitle")?;
    ensure!(
        matches!(title, OLD_TITLE | TITLE),
        "Mekhilta: unsupported title {title:?}"
    );
    let schema = doc
        .get_document("schema")
        .context("Mekhilta: missing schema")?;
    let version = doc
        .get_array("versions")
        .context("Mekhilta: missing Hebrew versions")?
        .first()
        .context("Mekhilta: no Hebrew version")?;

    if let Bson::Array(chapters) = version {
        ensure!(
            number(schema.get("depth")) == Some(3)
                && string_array(schema.get("addressTypes"))
                    == Some(vec!["Perek", "Pasuk", "Integer"])
                && string_array(schema.get("sectionNames"))
                    == Some(vec!["Chapter", "Verse", "Paragraph"]),
            "Mekhilta: array version does not have the known biblical chapter/verse schema"
        );
        return flatten_biblical(chapters, perush_id);
    }

    let Bson::Document(version) = version else {
        bail!("Mekhilta: Hebrew version must be an array or tractate document");
    };
    flatten_tractates(doc, schema, version, title, perush_id)
}

fn flatten_biblical(chapters: &[Bson], perush_id: i64) -> Result<Vec<Note>> {
    ensure!(chapters.len() <= 40, "Mekhilta: too many Exodus chapters");
    let mut notes = Vec::new();
    for (chapter_idx, chapter) in chapters.iter().enumerate() {
        let verses = chapter
            .as_array()
            .context("Mekhilta: chapter is not an array")?;
        ensure!(
            verses.len() <= VERSE_COUNTS[chapter_idx],
            "Mekhilta: too many verses in Exodus {}",
            chapter_idx + 1
        );
        for (verse_idx, verse) in verses.iter().enumerate() {
            let paragraphs = verse
                .as_array()
                .context("Mekhilta: verse is not a paragraph array")?;
            let mut note_idx = 0;
            for paragraph in paragraphs {
                let text = paragraph
                    .as_str()
                    .context("Mekhilta: paragraph is not text")?
                    .trim();
                if !text.is_empty() {
                    notes.push(make_note(
                        perush_id,
                        (chapter_idx + 1, verse_idx + 1),
                        note_idx,
                        text,
                    ));
                    note_idx += 1;
                }
            }
        }
    }
    Ok(notes)
}

fn flatten_tractates(
    doc: &Document,
    schema: &Document,
    version: &Document,
    title: &str,
    perush_id: i64,
) -> Result<Vec<Note>> {
    let nodes = schema
        .get_array("nodes")
        .context("Mekhilta: missing tractate nodes")?;
    let mut node_keys = HashMap::new();
    let mut sections_by_node = Vec::new();
    let mut source_text = BTreeMap::new();
    for (node_idx, node) in nodes.iter().enumerate() {
        let node = node
            .as_document()
            .context("Mekhilta: invalid tractate schema node")?;
        let key = node
            .get_str("key")
            .context("Mekhilta: tractate key missing")?;
        ensure!(
            key.starts_with("Tractate ") && number(node.get("depth")) == Some(2),
            "Mekhilta: unsupported tractate schema {key:?}"
        );
        ensure!(
            node_keys.insert(key, node_idx).is_none(),
            "Mekhilta: duplicate tractate {key}"
        );
        let sections = version
            .get_array(key)
            .with_context(|| format!("Mekhilta: missing tractate text {key}"))?;
        for (section_idx, section) in sections.iter().enumerate() {
            let paragraphs = section
                .as_array()
                .with_context(|| format!("Mekhilta: {key} section is not an array"))?;
            for (paragraph_idx, paragraph) in paragraphs.iter().enumerate() {
                let text = paragraph
                    .as_str()
                    .context("Mekhilta: tractate paragraph is not text")?
                    .trim();
                if !text.is_empty() {
                    source_text.insert((node_idx, section_idx + 1, paragraph_idx + 1), text);
                }
            }
        }
        sections_by_node.push(sections);
    }
    for key in version.keys() {
        ensure!(
            node_keys.contains_key(key.as_str()),
            "Mekhilta: unrecognized version node {key}"
        );
    }

    let chapter_nodes = doc
        .get_document("alt_structs")
        .context("Mekhilta: missing alt_structs")?
        .get_document("Chapter")
        .context("Mekhilta: no verse-level Chapter mapping")?
        .get_array("nodes")
        .context("Mekhilta: Chapter mapping has no nodes")?;
    let mut target_sources: BTreeMap<Target, BTreeSet<Source>> = BTreeMap::new();
    for node in chapter_nodes {
        let node = node
            .as_document()
            .context("Mekhilta: invalid Chapter node")?;
        ensure!(
            number(node.get("depth")) == Some(1)
                && string_array(node.get("sectionNames")) == Some(vec!["Verse"])
                && string_array(node.get("addressTypes")) == Some(vec!["Integer"]),
            "Mekhilta: Chapter mapping is not indexed by individual verses"
        );
        let chapter = mapped_chapter(node)?;
        let mut verse = match node.get("startingAddress") {
            Some(value) => positive_number(value).context("Mekhilta: invalid startingAddress")?,
            None => 1,
        };
        let mut skipped = HashSet::new();
        if let Some(value) = node.get("skipped_addresses") {
            for value in value
                .as_array()
                .context("Mekhilta: skipped_addresses is not an array")?
            {
                let value = positive_number(value).context("Mekhilta: invalid skipped address")?;
                ensure!(
                    value <= VERSE_COUNTS[chapter - 1] && skipped.insert(value),
                    "Mekhilta: invalid or duplicate skipped address"
                );
            }
        }
        for reference in node
            .get_array("refs")
            .context("Mekhilta: Chapter mapping has no refs")?
        {
            while skipped.contains(&verse) {
                verse += 1;
            }
            ensure!(
                verse <= VERSE_COUNTS[chapter - 1],
                "Mekhilta: Chapter refs exceed Exodus {chapter}"
            );
            let reference = reference
                .as_str()
                .context("Mekhilta: verse ref is not text")?;
            ensure!(!reference.is_empty(), "Mekhilta: empty verse ref");
            let sources = expand_reference(reference, title, &node_keys, &sections_by_node)?;
            let sources_for_target = target_sources.entry((chapter, verse)).or_default();
            ensure!(
                sources_for_target.is_empty(),
                "Mekhilta: duplicate mapping for Exodus {chapter}:{verse}"
            );
            sources_for_target.extend(sources);
            verse += 1;
        }
    }

    // The live Chapter map (inspected 2026-11-14) omits the final paragraph of
    // these two discussions. These are reviewed source-segment assignments,
    // not quotation matching: Vayassa 4:19–22 explains Exodus 16:15; Nezikin
    // 16:26–28 explains Exodus 22:14. The compact Hebrew anchor guards against
    // applying an obsolete assignment if Sefaria resegments either tractate.
    // https://www.sefaria.org/Mekhilta_DeRabbi_Yishmael,_Tractate_Vayassa.4.22
    // https://www.sefaria.org/Mekhilta_DeRabbi_Yishmael,_Tractate_Nezikin.16.28
    const REVIEWED_GAPS: [(&str, usize, usize, Target, &str); 2] = [
        ("Tractate Vayassa", 4, 22, (16, 15), "צידהשלחלהםלשבע"),
        ("Tractate Nezikin", 16, 28, (22, 14), "אםשכירהואבאבשכרו"),
    ];
    for (key, section, paragraph, target, anchor) in REVIEWED_GAPS {
        if let Some(&node_idx) = node_keys.get(key) {
            let source = (node_idx, section, paragraph);
            if let Some(text) = source_text.get(&source) {
                let assigned: Vec<Target> = target_sources
                    .iter()
                    .filter_map(|(&t, sources)| sources.contains(&source).then_some(t))
                    .collect();
                if !assigned.is_empty() {
                    ensure!(
                        assigned.contains(&target),
                        "Mekhilta: reviewed paragraph {key} {section}:{paragraph} has a conflicting assignment"
                    );
                    continue;
                }
                let letters: String = text
                    .chars()
                    .filter(|c| ('\u{05d0}'..='\u{05ea}').contains(c))
                    .collect();
                ensure!(
                    letters.contains(anchor),
                    "Mekhilta: reviewed paragraph {key} {section}:{paragraph} changed; review its verse assignment"
                );
                target_sources.entry(target).or_default().insert(source);
            }
        }
    }

    let covered: HashSet<Source> = target_sources.values().flatten().copied().collect();
    for source in source_text.keys() {
        ensure!(
            covered.contains(source),
            "Mekhilta: source paragraph {} {}:{} has no verse assignment",
            nodes[source.0]
                .as_document()
                .unwrap()
                .get_str("key")
                .unwrap(),
            source.1,
            source.2
        );
    }
    let mut notes = Vec::new();
    for (target, sources) in target_sources {
        let mut note_idx = 0;
        for source in sources {
            if let Some(text) = source_text.get(&source) {
                notes.push(make_note(perush_id, target, note_idx, text));
                note_idx += 1;
            }
        }
    }
    Ok(notes)
}

fn mapped_chapter(node: &Document) -> Result<usize> {
    let titles = node
        .get_array("titles")
        .context("Mekhilta: Chapter node has no titles")?;
    let mut chapters = Vec::new();
    for title in titles {
        let title = title
            .as_document()
            .context("Mekhilta: invalid Chapter title")?;
        if title.get_str("lang").ok() == Some("en") && title.get_bool("primary").ok() == Some(true)
        {
            let text = title
                .get_str("text")
                .context("Mekhilta: missing Chapter title text")?;
            let chapter = text
                .strip_prefix("Chapter ")
                .context("Mekhilta: unexpected Chapter title")?
                .parse::<usize>()?;
            ensure!(
                (1..=40).contains(&chapter),
                "Mekhilta: chapter outside Exodus"
            );
            chapters.push(chapter);
        }
    }
    ensure!(
        chapters.len() == 1,
        "Mekhilta: Chapter must have one primary English title"
    );
    Ok(chapters[0])
}

fn expand_reference(
    reference: &str,
    title: &str,
    node_keys: &HashMap<&str, usize>,
    sections_by_node: &[&Vec<Bson>],
) -> Result<Vec<Source>> {
    let reference = reference
        .strip_prefix(&format!("{title}, "))
        .with_context(|| {
            format!("Mekhilta: reference has an unexpected work title: {reference}")
        })?;
    let (key, addresses) = reference
        .rsplit_once(' ')
        .context("Mekhilta: ref has no tractate address")?;
    let node_idx = *node_keys
        .get(key)
        .with_context(|| format!("Mekhilta: unknown referenced tractate {key}"))?;
    let addresses = addresses.replace('–', "-");
    let (start, end) = match addresses.split_once('-') {
        Some((start, end)) => (start, Some(end)),
        None => (addresses.as_str(), None),
    };
    let (start_section, start_paragraph) = paragraph_address(start)?;
    let (end_section, end_paragraph) = match end {
        Some(end) if end.contains(':') => paragraph_address(end)?,
        Some(end) => (start_section, positive_str(end)?),
        None => (start_section, start_paragraph),
    };
    ensure!(
        (start_section, start_paragraph) <= (end_section, end_paragraph),
        "Mekhilta: reversed source range"
    );
    let sections = sections_by_node[node_idx];
    ensure!(
        end_section <= sections.len(),
        "Mekhilta: referenced section does not exist"
    );
    let mut sources = Vec::new();
    for section in start_section..=end_section {
        let paragraphs = sections[section - 1]
            .as_array()
            .context("Mekhilta: referenced section is not an array")?;
        let first = if section == start_section {
            start_paragraph
        } else {
            1
        };
        let last = if section == end_section {
            end_paragraph
        } else {
            paragraphs.len()
        };
        ensure!(
            first <= last && last <= paragraphs.len(),
            "Mekhilta: referenced paragraph does not exist"
        );
        sources.extend((first..=last).map(|paragraph| (node_idx, section, paragraph)));
    }
    Ok(sources)
}

fn paragraph_address(address: &str) -> Result<(usize, usize)> {
    let (section, paragraph) = address
        .split_once(':')
        .context("Mekhilta: expected section:paragraph address")?;
    Ok((positive_str(section)?, positive_str(paragraph)?))
}

fn positive_str(value: &str) -> Result<usize> {
    ensure!(
        !value.is_empty() && value.chars().all(|c| c.is_ascii_digit()),
        "Mekhilta: invalid integer address {value:?}"
    );
    let value = value.parse::<usize>()?;
    ensure!(value > 0, "Mekhilta: addresses are 1-based");
    Ok(value)
}

fn positive_number(value: &Bson) -> Option<usize> {
    match value {
        Bson::String(value) => positive_str(value).ok(),
        _ => number(Some(value))
            .and_then(|n| usize::try_from(n).ok())
            .filter(|n| *n > 0),
    }
}

fn number(value: Option<&Bson>) -> Option<i64> {
    match value {
        Some(Bson::Int32(n)) => Some(i64::from(*n)),
        Some(Bson::Int64(n)) => Some(*n),
        _ => None,
    }
}

fn string_array(value: Option<&Bson>) -> Option<Vec<&str>> {
    value?.as_array()?.iter().map(Bson::as_str).collect()
}

fn make_note(perush_id: i64, (chapter, verse): Target, note_idx: i64, text: &str) -> Note {
    Note {
        perush_id,
        perek_id: perek_mapping::first_perek_id(2, None) + chapter as i64 - 1,
        pasuk: verse as i64,
        note_idx,
        note_content: text.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{bson, doc};

    fn biblical() -> Document {
        serde_json::from_str(include_str!("../../tests/fixtures/mekhilta-biblical.json")).unwrap()
    }

    fn tractates() -> Document {
        serde_json::from_str(include_str!("../../tests/fixtures/mekhilta-tractates.json")).unwrap()
    }

    #[test]
    fn pinned_biblical_shape_preserves_empty_chapters_and_note_order() {
        let notes = flatten(&biblical(), 7).unwrap();
        assert_eq!(notes.len(), 3);
        assert_eq!(
            (notes[0].perek_id, notes[0].pasuk, notes[0].note_idx),
            (62, 1, 0)
        );
        assert_eq!(
            (notes[1].perek_id, notes[1].pasuk, notes[1].note_idx),
            (62, 1, 1)
        );
        assert_eq!(
            (notes[2].perek_id, notes[2].pasuk, notes[2].note_idx),
            (62, 3, 0)
        );
        assert!(notes.iter().all(|n| n.perush_id == 7));
    }

    #[test]
    fn tractate_refs_honor_starting_address_skipped_verses_and_exact_ranges() {
        let notes = flatten(&tractates(), 2).unwrap();
        let addresses: Vec<_> = notes
            .iter()
            .map(|n| (n.perek_id, n.pasuk, n.note_idx))
            .collect();
        assert_eq!(
            addresses,
            vec![
                (62, 6, 0),
                (62, 6, 1),
                (64, 11, 0),
                (64, 13, 0),
                (64, 13, 1)
            ]
        );
        assert_eq!(notes[0].note_content, "end of section four");
        assert_eq!(notes[1].note_content, "end of section five");
        assert_eq!(notes[4].note_content, "last included paragraph");
    }

    #[test]
    fn schema_must_explicitly_identify_biblical_addresses() {
        let mut doc = biblical();
        doc.get_document_mut("schema")
            .unwrap()
            .insert("sectionNames", bson!(["Siman", "Paragraph", "Comment"]));
        assert!(
            flatten(&doc, 1)
                .unwrap_err()
                .to_string()
                .contains("known biblical")
        );
    }

    #[test]
    fn uncovered_nonempty_source_paragraph_is_an_error() {
        let mut doc = tractates();
        let version = doc.get_array_mut("versions").unwrap()[0]
            .as_document_mut()
            .unwrap();
        let sections = version.get_array_mut("Tractate Pischa").unwrap();
        sections[0] = bson!(["an unmapped paragraph"]);
        assert!(
            flatten(&doc, 1)
                .unwrap_err()
                .to_string()
                .contains("no verse assignment")
        );
    }

    #[test]
    fn invalid_source_ranges_and_whole_ref_only_maps_fail_closed() {
        let mut doc = tractates();
        let nodes = doc
            .get_document_mut("alt_structs")
            .unwrap()
            .get_document_mut("Chapter")
            .unwrap()
            .get_array_mut("nodes")
            .unwrap();
        nodes[0].as_document_mut().unwrap().insert(
            "refs",
            bson!(["Mekhilta DeRabbi Yishmael, Tractate Pischa 4:4-6:99"]),
        );
        assert!(flatten(&doc, 1).is_err());
        let nodes = doc
            .get_document_mut("alt_structs")
            .unwrap()
            .get_document_mut("Chapter")
            .unwrap()
            .get_array_mut("nodes")
            .unwrap();
        nodes[0].as_document_mut().unwrap().remove("refs");
        nodes[0].as_document_mut().unwrap().insert(
            "wholeRef",
            "Mekhilta DeRabbi Yishmael, Tractate Pischa 1:1-5:24",
        );
        assert!(flatten(&doc, 1).is_err());
    }

    #[test]
    fn reviewed_missing_paragraphs_have_explicit_assignments_and_change_guards() {
        let mut doc = doc! {
            "enTitle": TITLE,
            "schema": { "nodes": [{"key": "Tractate Vayassa", "depth": 2}] },
            "alt_structs": { "Chapter": { "nodes": [] } },
            "versions": [{ "Tractate Vayassa": [[], [], [], vec![""; 22]] }],
        };
        let version = doc.get_array_mut("versions").unwrap()[0]
            .as_document_mut()
            .unwrap();
        version.get_array_mut("Tractate Vayassa").unwrap()[3]
            .as_array_mut()
            .unwrap()[21] = bson!("צידה שלח להם לשבע. זה יהושע בן נון");
        let notes = flatten(&doc, 1).unwrap();
        assert_eq!((notes[0].perek_id, notes[0].pasuk), (66, 15));
        let version = doc.get_array_mut("versions").unwrap()[0]
            .as_document_mut()
            .unwrap();
        version.get_array_mut("Tractate Vayassa").unwrap()[3]
            .as_array_mut()
            .unwrap()[21] = bson!("changed section");
        assert!(
            flatten(&doc, 1)
                .unwrap_err()
                .to_string()
                .contains("changed")
        );
    }

    #[test]
    fn invalid_exodus_verse_and_unknown_version_node_fail_closed() {
        let mut doc = biblical();
        doc.get_array_mut("versions").unwrap()[0]
            .as_array_mut()
            .unwrap()[0] = bson!(vec![Vec::<String>::new(); 23]);
        assert!(flatten(&doc, 1).is_err());
        let mut doc = tractates();
        doc.get_array_mut("versions").unwrap()[0]
            .as_document_mut()
            .unwrap()
            .insert("Unexpected", bson!([["extra text"]]));
        assert!(
            flatten(&doc, 1)
                .unwrap_err()
                .to_string()
                .contains("unrecognized version")
        );
    }

    /// Accept both the pinned biblical schema and the renamed tractate schema
    /// in refreshed dumps. No Sefaria content is fetched during the test.
    #[cfg(feature = "integration")]
    #[tokio::test]
    async fn mongo_pipeline_maps_both_known_mekhilta_schemas_without_dropping_paragraphs() {
        fn nonempty_paragraphs(value: &Bson) -> usize {
            match value {
                Bson::String(text) => usize::from(!text.trim().is_empty()),
                Bson::Array(items) => items.iter().map(nonempty_paragraphs).sum(),
                Bson::Document(nodes) => nodes.values().map(nonempty_paragraphs).sum(),
                _ => 0,
            }
        }

        let host = std::env::var("MONGO_HOST").unwrap_or_else(|_| "localhost".into());
        let port = std::env::var("MONGO_PORT").unwrap_or_else(|_| "27017".into());
        let database =
            std::env::var("DUMP_NAME").unwrap_or_else(|_| "sefaria-dump-5784-sivan-4".into());
        let client = mongodb::Client::with_uri_str(format!("mongodb://{host}:{port}"))
            .await
            .unwrap();
        let collection = client.database(&database).collection::<Document>("index");
        let mut pipeline = crate::aggregation::build_pipeline();
        pipeline.push(doc! { "$match": { "enTitle": { "$in": [OLD_TITLE, TITLE] } } });
        let mut cursor = collection.aggregate(pipeline).await.unwrap();
        let mut works = 0;
        while cursor.advance().await.unwrap() {
            let doc = cursor.deserialize_current().unwrap();
            let notes = flatten(&doc, 1).unwrap();
            let source = &doc.get_array("versions").unwrap()[0];
            let source_count = nonempty_paragraphs(source);
            assert!(source_count > 0, "selected Mekhilta version is empty");
            assert!(
                notes.len() >= source_count,
                "source paragraphs were dropped"
            );
            let verses: HashSet<_> = notes.iter().map(|n| (n.perek_id, n.pasuk)).collect();
            let keys: HashSet<_> = notes
                .iter()
                .map(|n| (n.perek_id, n.pasuk, n.note_idx))
                .collect();
            assert_eq!(keys.len(), notes.len(), "duplicate note indices at a verse");
            assert!(notes.iter().all(|n| {
                (51..=90).contains(&n.perek_id)
                    && n.pasuk > 0
                    && n.pasuk as usize <= VERSE_COUNTS[(n.perek_id - 51) as usize]
            }));
            assert!(verses.contains(&(62, 1)));

            if source.as_array().is_some() {
                assert_eq!(notes.len(), source_count);
                if doc.get_array("versionTitles").unwrap()[0].as_str()
                    == Some("Mekhilta -- Wikisource")
                {
                    assert_eq!(notes.len(), 805);
                    assert_eq!(verses.len(), 309);
                    assert!(verses.contains(&(81, 17)));
                }
            } else {
                // `flatten` verifies every nonempty source coordinate, even
                // where several source paragraphs share one biblical verse.
                assert!(notes.len() > verses.len());
                if source_count == 2043 {
                    // Full current source audited with its Chapter refs and
                    // the two reviewed gap assignments: 41 repeated targets.
                    assert_eq!(notes.len(), 2084);
                }
            }
            works += 1;
        }
        assert!(
            works > 0,
            "neither known Mekhilta title survived the pipeline"
        );
    }
}
